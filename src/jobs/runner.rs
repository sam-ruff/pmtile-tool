use std::path::PathBuf;

use chrono::{Duration, Utc};

use super::store::JobStore;
use super::{Job, JobKind, JobStatus, StatusDetail};
use crate::config::AppConfig;
use crate::extract::{ExtractRequest, PmtilesExtractor};

/// Filesystem locations the runner works with.
#[derive(Debug, Clone)]
pub struct RunnerPaths {
    pub planet: PathBuf,
    pub work_dir: PathBuf,
    pub exports_dir: PathBuf,
    pub region_cache_dir: PathBuf,
}

impl RunnerPaths {
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            planet: config.planet_path(),
            work_dir: config.work_dir(),
            exports_dir: config.exports_dir(),
            region_cache_dir: config.region_cache_dir(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RunnerError {
    #[error("io error: {0}")]
    Io(String),
    #[error("extract failed: {0}")]
    Extract(String),
    #[error("store error: {0}")]
    Store(String),
}

/// Execute one claimed job: write the region geojson to the work dir, run the
/// extract there, then atomically rename the finished archive into its final
/// directory so a download can never observe a partial file.
pub async fn run_job(
    job: &Job,
    store: &dyn JobStore,
    extractor: &dyn PmtilesExtractor,
    paths: &RunnerPaths,
    export_ttl: Duration,
    region_ttl: Duration,
) -> Result<(), RunnerError> {
    let geojson_path = paths.work_dir.join(format!("{}.geojson", job.id));
    let work_output = paths.work_dir.join(format!("{}.pmtiles", job.id));

    if let Err(e) = tokio::fs::write(&geojson_path, &job.geometry).await {
        let error = format!("failed to write region geojson: {e}");
        fail_job(job, store, &error).await?;
        return Err(RunnerError::Io(error));
    }

    let request = ExtractRequest {
        planet: paths.planet.clone(),
        region_geojson: geojson_path.clone(),
        maxzoom: job.maxzoom,
        output: work_output.clone(),
    };
    let result = extractor.extract(&request).await;
    let _ = tokio::fs::remove_file(&geojson_path).await;

    let outcome = match result {
        Ok(outcome) => outcome,
        Err(e) => {
            let _ = tokio::fs::remove_file(&work_output).await;
            let error = e.to_string();
            fail_job(job, store, &error).await?;
            return Err(RunnerError::Extract(error));
        }
    };

    let final_dir = match job.kind {
        JobKind::Custom => &paths.exports_dir,
        JobKind::Region => &paths.region_cache_dir,
    };
    let final_path = final_dir.join(format!("{}.pmtiles", job.id));
    if let Err(e) = tokio::fs::rename(&work_output, &final_path).await {
        let _ = tokio::fs::remove_file(&work_output).await;
        let error = format!("failed to move finished archive: {e}");
        fail_job(job, store, &error).await?;
        return Err(RunnerError::Io(error));
    }

    let now = Utc::now();
    let ttl = match job.kind {
        JobKind::Custom => export_ttl,
        JobKind::Region => region_ttl,
    };
    let expires_at = if job.pinned { None } else { Some(now + ttl) };
    store
        .update_status(
            &job.id,
            JobStatus::Done,
            StatusDetail {
                file_path: Some(final_path.to_string_lossy().into_owned()),
                file_size: Some(outcome.file_size),
                finished_at: Some(now),
                expires_at,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| RunnerError::Store(e.to_string()))?;
    Ok(())
}

async fn fail_job(job: &Job, store: &dyn JobStore, error: &str) -> Result<(), RunnerError> {
    store
        .update_status(
            &job.id,
            JobStatus::Failed,
            StatusDetail {
                error: Some(error.to_string()),
                finished_at: Some(Utc::now()),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| RunnerError::Store(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{ExtractError, ExtractOutcome, MockPmtilesExtractor};
    use crate::jobs::store::MockJobStore;
    use std::time::Duration as StdDuration;

    fn paths(dir: &std::path::Path) -> RunnerPaths {
        let paths = RunnerPaths {
            planet: dir.join("planet.pmtiles"),
            work_dir: dir.join("work"),
            exports_dir: dir.join("exports"),
            region_cache_dir: dir.join("region-cache"),
        };
        std::fs::create_dir_all(&paths.work_dir).expect("work dir");
        std::fs::create_dir_all(&paths.exports_dir).expect("exports dir");
        std::fs::create_dir_all(&paths.region_cache_dir).expect("cache dir");
        paths
    }

    #[tokio::test]
    async fn success_moves_file_and_marks_done() {
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(dir.path());
        let job = Job::new_custom(
            "t".into(),
            "{\"type\":\"Polygon\"}".into(),
            10,
            100,
            "1.1.1.1".into(),
        );
        let job_id = job.id.clone();

        let mut extractor = MockPmtilesExtractor::new();
        extractor.expect_extract().times(1).returning(|req| {
            std::fs::write(&req.output, b"pmtiles-bytes").expect("write output");
            Ok(ExtractOutcome {
                file_size: 13,
                duration: StdDuration::from_secs(1),
            })
        });

        let mut store = MockJobStore::new();
        let expected_path = paths
            .exports_dir
            .join(format!("{job_id}.pmtiles"))
            .to_string_lossy()
            .into_owned();
        store
            .expect_update_status()
            .withf(move |id, status, detail| {
                id == job_id
                    && *status == JobStatus::Done
                    && detail.file_path.as_deref() == Some(expected_path.as_str())
                    && detail.file_size == Some(13)
                    && detail.expires_at.is_some()
            })
            .times(1)
            .returning(|_, _, _| Ok(()));

        run_job(
            &job,
            &store,
            &extractor,
            &paths,
            Duration::hours(48),
            Duration::hours(48),
        )
        .await
        .expect("run");

        assert!(
            paths
                .exports_dir
                .join(format!("{}.pmtiles", job.id))
                .exists()
        );
        assert!(!paths.work_dir.join(format!("{}.pmtiles", job.id)).exists());
        assert!(!paths.work_dir.join(format!("{}.geojson", job.id)).exists());
    }

    #[tokio::test]
    async fn pinned_region_job_never_expires() {
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(dir.path());
        let job = Job::new_region("europe".into(), "{}".into(), 15, true);

        let mut extractor = MockPmtilesExtractor::new();
        extractor.expect_extract().times(1).returning(|req| {
            std::fs::write(&req.output, b"x").expect("write output");
            Ok(ExtractOutcome {
                file_size: 1,
                duration: StdDuration::from_secs(1),
            })
        });

        let mut store = MockJobStore::new();
        store
            .expect_update_status()
            .withf(|id, status, detail| {
                id == "europe"
                    && *status == JobStatus::Done
                    && detail.expires_at.is_none()
                    && detail
                        .file_path
                        .as_deref()
                        .is_some_and(|p| p.contains("region-cache"))
            })
            .times(1)
            .returning(|_, _, _| Ok(()));

        run_job(
            &job,
            &store,
            &extractor,
            &paths,
            Duration::hours(48),
            Duration::hours(48),
        )
        .await
        .expect("run");
    }

    #[tokio::test]
    async fn extract_failure_marks_failed_and_cleans_up() {
        let dir = tempfile::tempdir().expect("tempdir");
        let paths = paths(dir.path());
        let job = Job::new_custom("t".into(), "{}".into(), 10, 100, "1.1.1.1".into());
        let job_id = job.id.clone();

        let mut extractor = MockPmtilesExtractor::new();
        extractor.expect_extract().times(1).returning(|_| {
            Err(ExtractError::Failed {
                exit_code: Some(1),
                stderr_tail: "boom".into(),
            })
        });

        let mut store = MockJobStore::new();
        store
            .expect_update_status()
            .withf(move |id, status, detail| {
                id == job_id
                    && *status == JobStatus::Failed
                    && detail.error.as_deref().is_some_and(|e| e.contains("boom"))
            })
            .times(1)
            .returning(|_, _, _| Ok(()));

        let result = run_job(
            &job,
            &store,
            &extractor,
            &paths,
            Duration::hours(48),
            Duration::hours(48),
        )
        .await;
        assert!(matches!(result, Err(RunnerError::Extract(_))));
        assert!(!paths.work_dir.join(format!("{}.geojson", job.id)).exists());
        assert!(!paths.work_dir.join(format!("{}.pmtiles", job.id)).exists());
    }
}
