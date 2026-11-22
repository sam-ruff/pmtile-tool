//! End-to-end export pipeline test using the real go-pmtiles binary.
//! Run with: cargo test --test e2e_extract -- --ignored
//! Requires bin/pmtiles (scripts/dev-data.sh downloads it) or GO_PMTILES_BIN.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use pmtile_tool::config::AppConfig;
use pmtile_tool::extract::GoPmtilesExtractor;
use pmtile_tool::extract::sizer::GoPmtilesSizer;
use pmtile_tool::jobs::engine::JobEngine;
use pmtile_tool::jobs::runner::RunnerPaths;
use pmtile_tool::jobs::store::SqliteJobStore;
use pmtile_tool::martin_embed::HttpTileBackend;
use pmtile_tool::regions::RegionCatalog;
use pmtile_tool::rest::build_router;
use pmtile_tool::state::AppContext;
use tempfile::TempDir;
use tower::ServiceExt;

const CLIENT_IP: &str = "203.0.113.9";

fn find_pmtiles_bin() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("GO_PMTILES_BIN") {
        return Some(PathBuf::from(path));
    }
    let local = PathBuf::from("bin/pmtiles");
    if local.exists() {
        return std::fs::canonicalize(local).ok();
    }
    None
}

// Polygons inside the committed fixture's bounds (London, z0-4).
const LONDON_POLYGON: &str = r#"{"type":"Polygon","coordinates":[[[-0.15,51.47],[-0.05,51.47],[-0.05,51.53],[-0.15,51.53],[-0.15,51.47]]]}"#;
const TWO_DISJOINT_POLYGONS: &str = r#"{"type":"MultiPolygon","coordinates":[[[[-0.19,51.46],[-0.15,51.46],[-0.15,51.49],[-0.19,51.49],[-0.19,51.46]]],[[[-0.05,51.51],[-0.01,51.51],[-0.01,51.54],[-0.05,51.54],[-0.05,51.51]]]]}"#;

/// Router backed by the real extractor, cutting from the tiny fixture.
async fn real_router() -> (Router, TempDir) {
    let bin = find_pmtiles_bin()
        .expect("go-pmtiles binary required: run scripts/dev-data.sh or set GO_PMTILES_BIN");

    let dir = tempfile::tempdir().expect("tempdir");
    let config = AppConfig {
        data_dir: dir.path().to_path_buf(),
        ..Default::default()
    };
    config.ensure_dirs().expect("dirs");
    std::fs::copy("tests/fixtures/tiny.pmtiles", config.planet_path()).expect("fixture");

    let store = Arc::new(
        SqliteJobStore::open(&config.db_path())
            .await
            .expect("job store"),
    );
    let sizer = Arc::new(GoPmtilesSizer::new(
        bin.clone(),
        config.planet_path(),
        config.work_dir(),
        Duration::from_secs(60),
    ));
    let extractor = Arc::new(GoPmtilesExtractor::new(bin, Duration::from_secs(120)));
    let engine = JobEngine::new(
        store.clone(),
        extractor,
        RunnerPaths::from_config(&config),
        1,
        chrono::Duration::hours(48),
        chrono::Duration::hours(48),
    );
    engine.spawn_workers();

    let backend = Arc::new(HttpTileBackend::new("http://127.0.0.1:9".into()));
    let regions = Arc::new(RegionCatalog::new(Vec::new()));
    let ctx = AppContext::new(config, backend, regions, store, engine).with_sizer(sizer);
    (build_router(ctx), dir)
}

/// Submit an export and wait for it to finish, returning the job id.
async fn run_export(router: &Router, geometry: &str) -> String {
    let resp = router
        .clone()
        .oneshot(
            Request::post("/api/v1/exports")
                .header("cf-connecting-ip", CLIENT_IP)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"geometry":{geometry},"maxzoom":4}}"#
                )))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let body = resp.into_body().collect().await.expect("body").to_bytes();
    let job: serde_json::Value = serde_json::from_slice(&body).expect("json");
    let id = job["id"].as_str().expect("id").to_string();

    let mut final_status = String::new();
    for _ in 0..120 {
        let resp = router
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/exports/{id}"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let body = resp.into_body().collect().await.expect("body").to_bytes();
        let view: serde_json::Value = serde_json::from_slice(&body).expect("json");
        final_status = view["status"].as_str().unwrap_or("").to_string();
        if final_status == "failed" {
            panic!("extract failed: {}", view["error"]);
        }
        if final_status == "done" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert_eq!(final_status, "done", "job did not finish in time");
    id
}

async fn download(router: &Router, id: &str, range: Option<&str>) -> (StatusCode, Vec<u8>) {
    let mut request = Request::get(format!("/api/v1/exports/{id}/download"))
        .header("cf-connecting-ip", CLIENT_IP);
    if let Some(range) = range {
        request = request.header(header::RANGE, range);
    }
    let resp = router
        .clone()
        .oneshot(request.body(Body::empty()).expect("request"))
        .await
        .expect("response");
    let status = resp.status();
    let bytes = resp.into_body().collect().await.expect("body").to_bytes();
    (status, bytes.to_vec())
}

#[tokio::test]
#[ignore]
async fn full_export_pipeline_with_real_extractor() {
    let (router, _dir) = real_router().await;
    let id = run_export(&router, LONDON_POLYGON).await;

    // Ranged read: exactly what the in-browser pmtiles preview does.
    let (status, magic) = download(&router, &id, Some("bytes=0-6")).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(&magic[..], b"PMTiles", "output is not a v3 pmtiles archive");

    let (status, bytes) = download(&router, &id, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        bytes.len() > 127,
        "archive too small: {} bytes",
        bytes.len()
    );
}

#[tokio::test]
#[ignore]
async fn measured_estimate_matches_the_extract() {
    let (router, _dir) = real_router().await;
    let resp = router
        .clone()
        .oneshot(
            Request::post("/api/v1/exports/estimate")
                .header("cf-connecting-ip", CLIENT_IP)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"geometry":{LONDON_POLYGON},"maxzoom":4}}"#
                )))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.expect("body").to_bytes();
    let estimate: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(estimate["measured"], true);
    let estimated = estimate["bytes"].as_f64().expect("bytes");

    let id = run_export(&router, LONDON_POLYGON).await;
    let (_, bytes) = download(&router, &id, None).await;
    let actual = bytes.len() as f64;
    // go-pmtiles reports the size to two significant figures.
    assert!(
        (estimated - actual).abs() / actual < 0.1,
        "estimated {estimated} bytes, extract was {actual}"
    );
}

#[tokio::test]
#[ignore]
async fn disjoint_areas_export_into_one_archive() {
    let (router, _dir) = real_router().await;
    let id = run_export(&router, TWO_DISJOINT_POLYGONS).await;

    let (status, bytes) = download(&router, &id, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        &bytes[..7],
        b"PMTiles",
        "output is not a v3 pmtiles archive"
    );

    let resp = router
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/exports/{id}/geometry"))
                .header("cf-connecting-ip", CLIENT_IP)
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.expect("body").to_bytes();
    let geometry: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(geometry["coordinates"].as_array().expect("parts").len(), 2);
}
