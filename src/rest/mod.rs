pub mod doc;
mod download;
mod exports;
mod rate_limit;
mod regions;
mod status;
mod ui;
mod views;

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{any, get, post};
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub use rate_limit::client_ip;

use crate::error::ApiError;
use crate::martin_embed::tiles_proxy;
use crate::state::AppContext;

/// Wrap a route group in a per-client-IP rate limiter and spawn the janitor
/// that prunes its per-key state.
fn rate_limited(
    routes: Router<AppContext>,
    per_second: u64,
    burst: u32,
    label: &'static str,
) -> Router<AppContext> {
    let governor = GovernorConfigBuilder::default()
        .per_second(per_second)
        .burst_size(burst)
        .key_extractor(rate_limit::CfIpKeyExtractor)
        .finish();
    match governor {
        Some(config) => {
            let config = Arc::new(config);
            let janitor = Arc::clone(&config);
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    janitor.limiter().retain_recent();
                }
            });
            routes.layer(GovernorLayer::new(config))
        }
        None => {
            tracing::warn!(label, "invalid rate limit config, flood control disabled");
            routes
        }
    }
}

/// Build the public router: job creation behind an aggressive rate limiter,
/// downloads and estimates behind a laxer one (ranged preview reads are
/// chatty), plus the tile proxy, swagger docs and the embedded SPA fallback.
pub fn build_router(ctx: AppContext) -> Router {
    let limits = ctx.config.limits.clone();

    let job_routes = rate_limited(
        Router::new()
            .route("/api/v1/exports", post(exports::create_export))
            .route(
                "/api/v1/regions/{id}/extract",
                post(regions::region_extract),
            ),
        limits.job_rate_limit_per_second,
        limits.job_rate_limit_burst,
        "jobs",
    );

    let download_routes = rate_limited(
        Router::new()
            .route("/api/v1/exports/estimate", post(exports::estimate_export))
            .route(
                "/api/v1/regions/{id}/download",
                get(download::download_region),
            )
            .route(
                "/api/v1/exports/{id}/download",
                get(download::download_export),
            ),
        limits.download_rate_limit_per_second,
        limits.download_rate_limit_burst,
        "downloads",
    );

    let api = Router::new()
        .route("/health", get(health))
        .route("/api/v1/regions", get(regions::list_regions))
        .route("/api/v1/regions/{id}", get(regions::region_detail))
        .route(
            "/api/v1/regions/{id}/geometry",
            get(regions::region_geometry),
        )
        .route(
            "/api/v1/exports/{id}",
            get(exports::get_export).delete(exports::delete_export),
        )
        .route("/api/v1/status", get(status::status))
        .route("/tiles", any(tiles_proxy))
        .route("/tiles/{*path}", any(tiles_proxy))
        .merge(job_routes)
        .merge(download_routes)
        .with_state(ctx);

    let swagger =
        SwaggerUi::new("/swagger-ui").url("/swagger-ui/openapi.json", doc::ApiDoc::openapi());

    Router::new()
        .merge(api)
        .merge(swagger)
        .fallback(get(ui::serve_ui))
}

/// Liveness check that also confirms the embedded tile server responds.
async fn health(State(ctx): State<AppContext>) -> Result<&'static str, ApiError> {
    ctx.tiles
        .fetch("/health", HeaderMap::new())
        .await
        .map_err(|e| ApiError::Busy(format!("tile server not ready: {e}")))?;
    Ok("OK")
}

#[cfg(test)]
pub mod test_util {
    use std::sync::Arc;

    use chrono::Duration;
    use tempfile::TempDir;

    use crate::config::AppConfig;
    use crate::extract::MockPmtilesExtractor;
    use crate::jobs::engine::JobEngine;
    use crate::jobs::runner::RunnerPaths;
    use crate::jobs::store::SqliteJobStore;
    use crate::martin_embed::MockTileBackend;
    use crate::regions::{Region, RegionCatalog};
    use crate::state::AppContext;

    fn region(id: &str, parent: Option<&str>) -> Region {
        Region {
            id: id.into(),
            name: id.to_uppercase(),
            parent: parent.map(Into::into),
            geometry: geojson::Geometry::new_multi_polygon(vec![vec![vec![
                [0.0, 0.0],
                [1.0, 0.0],
                [1.0, 1.0],
                [0.0, 0.0],
            ]]]),
        }
    }

    /// Three-region catalog used across tests.
    pub fn test_regions() -> RegionCatalog {
        RegionCatalog::new(vec![
            region("europe", None),
            region("united-kingdom", Some("europe")),
            region("england", Some("united-kingdom")),
        ])
    }

    /// A full test app: real in-memory job store and engine (workers NOT
    /// spawned), mock tile backend and extractor, tempdir-backed data dir.
    pub struct TestApp {
        pub ctx: AppContext,
        pub store: Arc<SqliteJobStore>,
        pub dir: TempDir,
    }

    pub async fn test_app() -> TestApp {
        test_app_custom(MockPmtilesExtractor::new(), false, |_| {}).await
    }

    pub async fn test_app_with_extractor(
        extractor: MockPmtilesExtractor,
        spawn_workers: bool,
    ) -> TestApp {
        test_app_custom(extractor, spawn_workers, |_| {}).await
    }

    pub async fn test_app_custom(
        extractor: MockPmtilesExtractor,
        spawn_workers: bool,
        tweak: impl FnOnce(&mut AppConfig),
    ) -> TestApp {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            ..Default::default()
        };
        tweak(&mut config);
        config.ensure_dirs().expect("dirs");

        let store = Arc::new(SqliteJobStore::open_in_memory().await.expect("store"));
        let engine = JobEngine::new(
            store.clone(),
            Arc::new(extractor),
            RunnerPaths::from_config(&config),
            1,
            Duration::hours(48),
            Duration::hours(48),
        );
        if spawn_workers {
            engine.spawn_workers();
        }
        let ctx = AppContext::new(
            config,
            Arc::new(MockTileBackend::new()),
            Arc::new(test_regions()),
            store.clone(),
            engine,
        );
        TestApp { ctx, store, dir }
    }
}
