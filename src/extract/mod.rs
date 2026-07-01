pub mod estimate;
mod go_pmtiles;
pub mod validate;

use std::path::PathBuf;
use std::time::Duration;

pub use go_pmtiles::GoPmtilesExtractor;

#[derive(Debug, Clone)]
pub struct ExtractRequest {
    pub planet: PathBuf,
    /// Path to a GeoJSON file holding the region polygon.
    pub region_geojson: PathBuf,
    pub maxzoom: u8,
    pub output: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ExtractOutcome {
    pub file_size: u64,
    pub duration: Duration,
}

#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    #[error("pmtiles extract failed (exit {exit_code:?}): {stderr_tail}")]
    Failed {
        exit_code: Option<i32>,
        stderr_tail: String,
    },
    #[error("pmtiles extract timed out after {0:?}")]
    TimedOut(Duration),
    #[error("io error running pmtiles extract: {0}")]
    Io(String),
}

/// Runs a pmtiles extract. The production impl shells out to the go-pmtiles
/// binary; unit tests mock this trait.
#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait PmtilesExtractor: Send + Sync {
    async fn extract(&self, req: &ExtractRequest) -> Result<ExtractOutcome, ExtractError>;
}
