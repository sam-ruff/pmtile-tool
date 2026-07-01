use axum::Json;
use axum::extract::State;
use serde::Serialize;

use crate::error::ApiError;
use crate::state::AppContext;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct StatusView {
    pub queued: u32,
    pub running: u32,
    pub disk_free_bytes: u64,
    pub region_cache_bytes: u64,
    pub version: &'static str,
}

/// Service status: queue depth and disk headroom.
#[utoipa::path(get, path = "/api/v1/status", tag = "status",
    responses((status = 200, body = StatusView)))]
pub async fn status(State(ctx): State<AppContext>) -> Result<Json<StatusView>, ApiError> {
    Ok(Json(StatusView {
        queued: ctx.store.queued_count().await?,
        running: ctx.store.running_count().await?,
        disk_free_bytes: crate::disk::free_bytes(&ctx.config.data_dir).unwrap_or(0),
        region_cache_bytes: crate::disk::dir_size(&ctx.config.region_cache_dir()).unwrap_or(0),
        version: env!("CARGO_PKG_VERSION"),
    }))
}
