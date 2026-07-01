use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use pmtile_tool::config::AppConfig;
use pmtile_tool::extract::GoPmtilesExtractor;
use pmtile_tool::jobs::engine::JobEngine;
use pmtile_tool::jobs::runner::RunnerPaths;
use pmtile_tool::jobs::store::SqliteJobStore;
use pmtile_tool::martin_embed::{HttpTileBackend, start_martin};
use pmtile_tool::regions::RegionCatalog;
use pmtile_tool::rest::build_router;
use pmtile_tool::state::AppContext;
use tower::ServiceExt;

/// Boots the embedded martin server against the committed fixture (as the
/// planet archive) and exercises the tile proxy end to end. This test is the
/// canary for API drift in the martin-embedded fork.
#[tokio::test]
async fn martin_serves_planet_fixture_through_proxy() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::copy(
        "tests/fixtures/tiny.pmtiles",
        dir.path().join("planet.pmtiles"),
    )
    .expect("copy fixture");

    let config = AppConfig {
        data_dir: dir.path().to_path_buf(),
        martin_listen: "127.0.0.1:3199".into(),
        ..Default::default()
    };
    config.ensure_dirs().expect("dirs");

    // The martin server future is !Send, so it runs on a LocalSet.
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (server, addr) = start_martin(&config).await.expect("start martin");
            tokio::task::spawn_local(server);

            let backend = Arc::new(HttpTileBackend::new(format!("http://{addr}")));
            let regions = Arc::new(RegionCatalog::new(Vec::new()));
            let store = Arc::new(
                SqliteJobStore::open(&config.db_path())
                    .await
                    .expect("job store"),
            );
            let extractor = Arc::new(GoPmtilesExtractor::new(
                "pmtiles".into(),
                Duration::from_secs(60),
            ));
            let engine = JobEngine::new(
                store.clone(),
                extractor,
                RunnerPaths::from_config(&config),
                1,
                chrono::Duration::hours(48),
                chrono::Duration::hours(48),
            );
            let app = build_router(AppContext::new(config, backend, regions, store, engine));

            let mut healthy = false;
            for _ in 0..50 {
                let resp = app
                    .clone()
                    .oneshot(
                        Request::get("/health")
                            .body(Body::empty())
                            .expect("request"),
                    )
                    .await
                    .expect("health response");
                if resp.status() == StatusCode::OK {
                    healthy = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            assert!(healthy, "martin never became healthy");

            let resp = app
                .clone()
                .oneshot(
                    Request::get("/tiles/catalog")
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("catalog response");
            assert_eq!(resp.status(), StatusCode::OK);
            let body = resp
                .into_body()
                .collect()
                .await
                .expect("catalog body")
                .to_bytes();
            let text = String::from_utf8_lossy(&body);
            assert!(text.contains("planet"), "catalog missing planet: {text}");

            let resp = app
                .clone()
                .oneshot(
                    Request::get("/tiles/planet/0/0/0")
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("tile response");
            assert_eq!(resp.status(), StatusCode::OK);

            let resp = app
                .clone()
                .oneshot(
                    Request::get("/tiles/planet/14/8000/5000")
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("missing tile response");
            assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        })
        .await;
}
