use axum::Json;
use axum::extract::State;
use serde::Serialize;

use crate::config::AppConfig;
use crate::error::ApiError;
use crate::state::AppContext;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct StatusView {
    pub queued: u32,
    pub running: u32,
    pub disk_free_bytes: u64,
    pub region_cache_bytes: u64,
    pub version: &'static str,
    pub limits: LimitsView,
}

/// Export limits the UI shows and checks against before submitting.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct LimitsView {
    pub max_maxzoom: u8,
    pub max_export_bytes: u64,
    pub max_estimated_tiles: u64,
    pub max_polygon_vertices: usize,
    pub max_export_regions: usize,
    pub export_ttl_hours: i64,
}

impl LimitsView {
    pub fn from_config(config: &AppConfig) -> Self {
        let limits = &config.limits;
        Self {
            max_maxzoom: limits.max_maxzoom,
            max_export_bytes: limits.max_custom_export_bytes(),
            max_estimated_tiles: limits.max_estimated_tiles,
            max_polygon_vertices: limits.max_polygon_vertices,
            max_export_regions: limits.max_export_regions,
            export_ttl_hours: config.retention.export_ttl_hours,
        }
    }
}

/// Service status: queue depth, disk headroom and export limits.
#[utoipa::path(get, path = "/api/v1/status", tag = "status",
    responses((status = 200, body = StatusView)))]
pub async fn status(State(ctx): State<AppContext>) -> Result<Json<StatusView>, ApiError> {
    Ok(Json(StatusView {
        queued: ctx.store.queued_count().await?,
        running: ctx.store.running_count().await?,
        disk_free_bytes: crate::disk::free_bytes(&ctx.config.data_dir).unwrap_or(0),
        region_cache_bytes: crate::disk::dir_size(&ctx.config.region_cache_dir()).unwrap_or(0),
        version: env!("PMTILES_VERSION"),
        limits: LimitsView::from_config(&ctx.config),
    }))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::extract::MockPmtilesExtractor;
    use crate::rest::build_router;
    use crate::rest::test_util::test_app_custom;

    #[tokio::test]
    async fn status_reports_limits() {
        let app = test_app_custom(MockPmtilesExtractor::new(), false, |c| {
            c.limits.max_custom_export_gb = 2;
            c.limits.max_export_regions = 7;
            c.retention.export_ttl_hours = 12;
        })
        .await;
        let router = build_router(app.ctx.clone());

        let resp = router
            .oneshot(
                Request::get("/api/v1/status")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.expect("body").to_bytes();
        let status: serde_json::Value = serde_json::from_slice(&body).expect("json");
        let limits = &status["limits"];
        assert_eq!(limits["max_maxzoom"], 15);
        assert_eq!(limits["max_export_bytes"], 2 * 1024 * 1024 * 1024_u64);
        assert_eq!(limits["max_estimated_tiles"], 150_000_000);
        assert_eq!(limits["max_polygon_vertices"], 1000);
        assert_eq!(limits["max_export_regions"], 7);
        assert_eq!(limits["export_ttl_hours"], 12);
    }
}
