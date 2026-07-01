use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::HeaderValue;
use axum::http::header::CONTENT_DISPOSITION;
use axum::response::Response;
use chrono::Utc;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::error::ApiError;
use crate::jobs::{JobKind, JobStatus, filename_for};
use crate::state::AppContext;

/// Download a finished custom export (supports HTTP range requests, which the
/// in-browser pmtiles preview relies on).
#[utoipa::path(get, path = "/api/v1/exports/{id}/download", tag = "exports",
    params(("id" = String, Path, description = "Job id")),
    responses(
        (status = 200, description = "The archive"),
        (status = 206, description = "Partial content"),
        (status = 404, description = "Unknown or unfinished job"),
        (status = 410, description = "Export expired")))]
pub async fn download_export(
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
    req: Request,
) -> Result<Response, ApiError> {
    serve_job_file(&ctx, &id, JobKind::Custom, req).await
}

/// Download a finished region extract.
#[utoipa::path(get, path = "/api/v1/regions/{id}/download", tag = "regions",
    params(("id" = String, Path, description = "Region id")),
    responses(
        (status = 200, description = "The archive"),
        (status = 206, description = "Partial content"),
        (status = 404, description = "Region not generated"),
        (status = 410, description = "Extract expired")))]
pub async fn download_region(
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
    req: Request,
) -> Result<Response, ApiError> {
    serve_job_file(&ctx, &id, JobKind::Region, req).await
}

async fn serve_job_file(
    ctx: &AppContext,
    id: &str,
    kind: JobKind,
    req: Request,
) -> Result<Response, ApiError> {
    let job = ctx
        .store
        .get(id)
        .await?
        .filter(|j| j.kind == kind)
        .ok_or_else(|| ApiError::NotFound(format!("unknown job: {id}")))?;

    match job.status {
        JobStatus::Done => {}
        JobStatus::Expired => {
            return Err(ApiError::Gone("this download has expired".into()));
        }
        other => {
            return Err(ApiError::NotFound(format!(
                "job is not finished (status: {})",
                other.as_str()
            )));
        }
    }
    let file_path = job
        .file_path
        .as_deref()
        .filter(|p| std::path::Path::new(p).exists())
        .ok_or_else(|| ApiError::Gone("the archive is no longer available".into()))?;

    if let Err(e) = ctx.store.touch_download(id, Utc::now()).await {
        tracing::warn!(job = id, error = %e, "failed to record download");
    }

    let response = ServeFile::new(file_path)
        .oneshot(req)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to serve file: {e}")))?;
    let mut response = response.map(Body::new);

    let disposition = format!("attachment; filename=\"{}\"", filename_for(&job));
    if let Ok(value) = HeaderValue::from_str(&disposition) {
        response.headers_mut().insert(CONTENT_DISPOSITION, value);
    }
    Ok(response)
}
