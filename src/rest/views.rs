use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::jobs::{Job, JobKind, JobStatus};

/// Public JSON view of a job.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct JobView {
    pub id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
    pub maxzoom: u8,
    pub estimated_tiles: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    /// Present once the job is done; also serves in-browser previews via
    /// HTTP range requests.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

impl JobView {
    pub fn from_job(job: &Job) -> Self {
        let download_url = (job.status == JobStatus::Done).then(|| match job.kind {
            JobKind::Custom => format!("/api/v1/exports/{}/download", job.id),
            JobKind::Region => format!("/api/v1/regions/{}/download", job.id),
        });
        Self {
            id: job.id.clone(),
            kind: job.kind,
            status: job.status,
            region_id: job.region_id.clone(),
            maxzoom: job.maxzoom,
            estimated_tiles: job.estimated_tiles,
            file_size: job.file_size,
            error: job.error.clone(),
            created_at: job.created_at,
            finished_at: job.finished_at,
            expires_at: job.expires_at,
            download_url,
        }
    }
}
