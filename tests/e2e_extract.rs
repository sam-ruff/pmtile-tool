//! End-to-end export pipeline test using the real go-pmtiles binary.
//! Run with: cargo test --test e2e_extract -- --ignored
//! Requires bin/pmtiles (scripts/dev-data.sh downloads it) or GO_PMTILES_BIN.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use pmtile_tool::config::AppConfig;
use pmtile_tool::extract::GoPmtilesExtractor;
use pmtile_tool::jobs::engine::JobEngine;
use pmtile_tool::jobs::runner::RunnerPaths;
use pmtile_tool::jobs::store::SqliteJobStore;
use pmtile_tool::martin_embed::HttpTileBackend;
use pmtile_tool::regions::RegionCatalog;
use pmtile_tool::rest::build_router;
use pmtile_tool::state::AppContext;
use tower::ServiceExt;

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

// Polygon inside the committed fixture's bounds (London, z0-4).
const LONDON_POLYGON: &str = r#"{"type":"Polygon","coordinates":[[[-0.15,51.47],[-0.05,51.47],[-0.05,51.53],[-0.15,51.53],[-0.15,51.47]]]}"#;

#[tokio::test]
#[ignore]
async fn full_export_pipeline_with_real_extractor() {
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
    let router = build_router(AppContext::new(config, backend, regions, store, engine));

    let resp = router
        .clone()
        .oneshot(
            Request::post("/api/v1/exports")
                .header("cf-connecting-ip", "203.0.113.9")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"geometry":{LONDON_POLYGON},"maxzoom":4}}"#
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
        if final_status == "done" || final_status == "failed" {
            if final_status == "failed" {
                panic!("extract failed: {}", view["error"]);
            }
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert_eq!(final_status, "done", "job did not finish in time");

    // Ranged read: exactly what the in-browser pmtiles preview does.
    let resp = router
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/exports/{id}/download"))
                .header(header::RANGE, "bytes=0-6")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);
    let magic = resp.into_body().collect().await.expect("body").to_bytes();
    assert_eq!(&magic[..], b"PMTiles", "output is not a v3 pmtiles archive");

    let resp = router
        .oneshot(
            Request::get(format!("/api/v1/exports/{id}/download"))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.expect("body").to_bytes();
    assert!(
        bytes.len() > 127,
        "archive too small: {} bytes",
        bytes.len()
    );
}
