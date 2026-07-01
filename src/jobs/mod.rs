pub mod cleanup;
pub mod engine;
pub mod runner;
pub mod store;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Custom,
    Region,
}

impl JobKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Custom => "custom",
            Self::Region => "region",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Failed,
    Expired,
}

impl JobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Expired => "expired",
        }
    }
}

/// One extract job. Region jobs use the region id as the job id so a region
/// is only ever generated once at a time.
#[derive(Debug, Clone)]
pub struct Job {
    pub id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    pub client_ip: Option<String>,
    pub region_id: Option<String>,
    /// GeoJSON geometry (Polygon or MultiPolygon) the extract is cut to.
    pub geometry: String,
    pub maxzoom: u8,
    pub estimated_tiles: u64,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub error: Option<String>,
    pub pinned: bool,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_download_at: Option<DateTime<Utc>>,
}

impl Job {
    /// A freshly queued custom export job.
    pub fn new_custom(
        geometry: String,
        maxzoom: u8,
        estimated_tiles: u64,
        client_ip: String,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            kind: JobKind::Custom,
            status: JobStatus::Queued,
            client_ip: Some(client_ip),
            region_id: None,
            geometry,
            maxzoom,
            estimated_tiles,
            file_path: None,
            file_size: None,
            error: None,
            pinned: false,
            created_at: Utc::now(),
            started_at: None,
            finished_at: None,
            expires_at: None,
            last_download_at: None,
        }
    }

    /// A freshly queued region extract job (id = region id).
    pub fn new_region(region_id: String, geometry: String, maxzoom: u8, pinned: bool) -> Self {
        Self {
            id: region_id.clone(),
            kind: JobKind::Region,
            status: JobStatus::Queued,
            client_ip: None,
            region_id: Some(region_id),
            geometry,
            maxzoom,
            estimated_tiles: 0,
            file_path: None,
            file_size: None,
            error: None,
            pinned,
            created_at: Utc::now(),
            started_at: None,
            finished_at: None,
            expires_at: None,
            last_download_at: None,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(self.status, JobStatus::Queued | JobStatus::Running)
    }
}

/// Field updates applied together with a status transition.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StatusDetail {
    pub error: Option<String>,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
}
