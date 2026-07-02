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
    pub name: Option<String>,
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
    /// Geographic bounds [west, south, east, north] in lon/lat, so the UI can
    /// outline and zoom to the extract area.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<[f64; 4]>,
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
            name: job.name.clone(),
            region_id: job.region_id.clone(),
            maxzoom: job.maxzoom,
            estimated_tiles: job.estimated_tiles,
            file_size: job.file_size,
            error: job.error.clone(),
            created_at: job.created_at,
            finished_at: job.finished_at,
            expires_at: job.expires_at,
            download_url,
            bounds: bounds_of(&job.geometry),
        }
    }
}

/// Bounding box [west, south, east, north] of a stored GeoJSON geometry.
fn bounds_of(geometry: &str) -> Option<[f64; 4]> {
    use geo::BoundingRect;
    let geom: geojson::Geometry = serde_json::from_str(geometry).ok()?;
    let rect = crate::extract::validate::to_multipolygon(&geom)?.bounding_rect()?;
    Some([rect.min().x, rect.min().y, rect.max().x, rect.max().y])
}

#[cfg(test)]
mod tests {
    use super::bounds_of;

    #[test]
    fn bounds_of_polygon_is_its_extent() {
        let geometry = r#"{"type":"Polygon","coordinates":[[[-0.16,51.49],[-0.11,51.49],[-0.11,51.52],[-0.16,51.52],[-0.16,51.49]]]}"#;
        let b = bounds_of(geometry).expect("bounds");
        assert!((b[0] - -0.16).abs() < 1e-9);
        assert!((b[1] - 51.49).abs() < 1e-9);
        assert!((b[2] - -0.11).abs() < 1e-9);
        assert!((b[3] - 51.52).abs() < 1e-9);
    }

    #[test]
    fn bounds_of_invalid_geometry_is_none() {
        assert!(bounds_of("not json").is_none());
    }
}
