use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Serialize;

use super::views::JobView;
use crate::error::ApiError;
use crate::jobs::{Job, JobKind, JobStatus};
use crate::regions::RegionSummary;
use crate::state::AppContext;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct RegionDetail {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub has_children: bool,
    /// Latest extract job for this region, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extract: Option<JobView>,
}

/// List all regions as a flat tree (client rebuilds the hierarchy via parent).
#[utoipa::path(get, path = "/api/v1/regions", tag = "regions",
    responses((status = 200, body = [RegionSummary])))]
pub async fn list_regions(State(ctx): State<AppContext>) -> Json<Vec<RegionSummary>> {
    Json(ctx.regions.summaries())
}

/// One region with its extract status.
#[utoipa::path(get, path = "/api/v1/regions/{id}", tag = "regions",
    params(("id" = String, Path, description = "Region id")),
    responses((status = 200, body = RegionDetail), (status = 404, description = "Unknown region")))]
pub async fn region_detail(
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> Result<Json<RegionDetail>, ApiError> {
    let region = ctx
        .regions
        .get(&id)
        .ok_or_else(|| ApiError::NotFound(format!("unknown region: {id}")))?;
    let extract = ctx
        .store
        .get(&id)
        .await?
        .filter(|j| j.kind == JobKind::Region)
        .map(|j| JobView::from_job(&j));
    Ok(Json(RegionDetail {
        id: region.id.clone(),
        name: region.name.clone(),
        parent: region.parent.clone(),
        has_children: ctx.regions.has_children(&id),
        extract,
    }))
}

/// The GeoJSON MultiPolygon for one region.
#[utoipa::path(get, path = "/api/v1/regions/{id}/geometry", tag = "regions",
    params(("id" = String, Path, description = "Region id")),
    responses((status = 200, description = "GeoJSON geometry"), (status = 404, description = "Unknown region")))]
pub async fn region_geometry(
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> Result<Json<geojson::Geometry>, ApiError> {
    let region = ctx
        .regions
        .get(&id)
        .ok_or_else(|| ApiError::NotFound(format!("unknown region: {id}")))?;
    Ok(Json(region.geometry.clone()))
}

/// Request a region extract: returns the cached/pending state, or enqueues a
/// fresh job. Region extracts are shared artefacts, so they carry no per-IP
/// quota; the flood-control rate limit still applies.
#[utoipa::path(post, path = "/api/v1/regions/{id}/extract", tag = "regions",
    params(("id" = String, Path, description = "Region id")),
    responses(
        (status = 200, body = JobView, description = "Already cached or in progress"),
        (status = 202, body = JobView, description = "Extract job enqueued"),
        (status = 404, description = "Unknown region"),
        (status = 503, description = "Queue full")))]
pub async fn region_extract(
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<JobView>), ApiError> {
    let region = ctx
        .regions
        .get(&id)
        .ok_or_else(|| ApiError::NotFound(format!("unknown region: {id}")))?;

    let existing = ctx
        .store
        .get(&id)
        .await?
        .filter(|j| j.kind == JobKind::Region);
    if let Some(job) = &existing {
        let file_ok = job
            .file_path
            .as_deref()
            .is_some_and(|p| std::path::Path::new(p).exists());
        if job.is_active() || (job.status == JobStatus::Done && file_ok) {
            return Ok((StatusCode::OK, Json(JobView::from_job(job))));
        }
    }

    if ctx.store.queued_count().await? >= ctx.config.limits.queue_depth_max {
        return Err(ApiError::Busy(
            "export queue is full, try again later".into(),
        ));
    }

    // Replace a stale row (failed, expired, or done with a lost file).
    if existing.is_some() {
        ctx.store.delete(&id).await?;
    }
    let geometry =
        serde_json::to_string(&region.geometry).map_err(|e| ApiError::Internal(e.to_string()))?;
    let job = Job::new_region(id, geometry, ctx.config.limits.max_maxzoom, false);
    let view = JobView::from_job(&job);
    ctx.engine.enqueue(job).await?;
    Ok((StatusCode::ACCEPTED, Json(view)))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::jobs::JobStatus;
    use crate::jobs::store::JobStore;
    use crate::rest::build_router;
    use crate::rest::test_util::test_app;

    #[tokio::test]
    async fn lists_regions() {
        let app = test_app().await;
        let router = build_router(app.ctx.clone());
        let resp = router
            .oneshot(
                Request::get("/api/v1/regions")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.expect("body").to_bytes();
        let regions: Vec<serde_json::Value> = serde_json::from_slice(&body).expect("json");
        assert_eq!(regions.len(), 3);
        let europe = regions
            .iter()
            .find(|r| r["id"] == "europe")
            .expect("europe present");
        assert_eq!(europe["has_children"], true);
    }

    #[tokio::test]
    async fn region_geometry_roundtrips() {
        let app = test_app().await;
        let router = build_router(app.ctx.clone());
        let resp = router
            .oneshot(
                Request::get("/api/v1/regions/united-kingdom/geometry")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.expect("body").to_bytes();
        let geometry: serde_json::Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(geometry["type"], "MultiPolygon");
    }

    #[tokio::test]
    async fn unknown_region_is_404() {
        let app = test_app().await;
        let router = build_router(app.ctx.clone());
        let resp = router
            .oneshot(
                Request::get("/api/v1/regions/atlantis/geometry")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn region_extract_enqueues_then_reports_pending() {
        let app = test_app().await;
        let router = build_router(app.ctx.clone());

        let resp = router
            .clone()
            .oneshot(
                Request::post("/api/v1/regions/england/extract")
                    .header("cf-connecting-ip", "203.0.113.5")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::ACCEPTED);

        let job = app
            .store
            .get("england")
            .await
            .expect("get")
            .expect("job exists");
        assert_eq!(job.status, JobStatus::Queued);
        assert!(!job.pinned);

        // Second request sees the queued job rather than enqueueing another.
        let resp = router
            .oneshot(
                Request::post("/api/v1/regions/england/extract")
                    .header("cf-connecting-ip", "203.0.113.5")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(app.store.queued_count().await.expect("count"), 1);
    }

    #[tokio::test]
    async fn region_detail_includes_extract_state() {
        let app = test_app().await;
        let router = build_router(app.ctx.clone());

        router
            .clone()
            .oneshot(
                Request::post("/api/v1/regions/england/extract")
                    .header("cf-connecting-ip", "203.0.113.5")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        let resp = router
            .oneshot(
                Request::get("/api/v1/regions/england")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.expect("body").to_bytes();
        let detail: serde_json::Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(detail["extract"]["status"], "queued");
    }
}
