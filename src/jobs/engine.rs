use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::Duration;
use tokio::sync::Notify;

use super::runner::{RunnerPaths, run_job};
use super::store::{JobStore, StoreError};
use super::{Job, JobStatus, StatusDetail};
use crate::extract::PmtilesExtractor;
use crate::regions::RegionCatalog;

const IDLE_POLL: StdDuration = StdDuration::from_secs(30);

/// Owns the worker tasks that drain the job queue.
pub struct JobEngine {
    store: Arc<dyn JobStore>,
    extractor: Arc<dyn PmtilesExtractor>,
    paths: RunnerPaths,
    notify: Notify,
    concurrency: usize,
    export_ttl: Duration,
    region_ttl: Duration,
}

impl JobEngine {
    pub fn new(
        store: Arc<dyn JobStore>,
        extractor: Arc<dyn PmtilesExtractor>,
        paths: RunnerPaths,
        concurrency: usize,
        export_ttl: Duration,
        region_ttl: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            store,
            extractor,
            paths,
            notify: Notify::new(),
            concurrency: concurrency.max(1),
            export_ttl,
            region_ttl,
        })
    }

    /// Insert a new job and wake a worker.
    pub async fn enqueue(&self, job: Job) -> Result<(), StoreError> {
        self.store.insert(&job).await?;
        self.notify.notify_one();
        Ok(())
    }

    /// Startup recovery: requeue jobs that were mid-run when the process died
    /// and expire done jobs whose files vanished from disk.
    pub async fn recover(&self) -> Result<(), StoreError> {
        let requeued = self.store.requeue_running().await?;
        if requeued > 0 {
            tracing::info!(requeued, "requeued interrupted jobs");
        }
        for job in self.store.done_jobs().await? {
            let missing = job
                .file_path
                .as_deref()
                .is_none_or(|p| !std::path::Path::new(p).exists());
            if missing {
                tracing::warn!(job = job.id, "done job lost its file, marking expired");
                self.store
                    .update_status(&job.id, JobStatus::Expired, StatusDetail::default())
                    .await?;
            }
        }
        Ok(())
    }

    /// Enqueue any configured seed regions that are not already generated or
    /// in flight. Seeds are pinned so the sweeper never evicts them.
    pub async fn seed(
        &self,
        regions: &RegionCatalog,
        seed_ids: &[String],
        maxzoom: u8,
    ) -> Result<(), StoreError> {
        for id in seed_ids {
            let Some(region) = regions.get(id) else {
                tracing::warn!(region = id, "seed region not in the index, skipping");
                continue;
            };
            let needs_run = match self.store.get(id).await? {
                Some(job) if job.is_active() => false,
                Some(job) if job.status == JobStatus::Done => job
                    .file_path
                    .as_deref()
                    .is_none_or(|p| !std::path::Path::new(p).exists()),
                _ => true,
            };
            if !needs_run {
                continue;
            }
            let geometry = serde_json::to_string(&region.geometry)
                .map_err(|e| StoreError::Db(format!("seed geometry serialisation: {e}")))?;
            // Replace any stale (failed/expired) row before re-inserting.
            self.store.delete(id).await?;
            tracing::info!(region = id, "seeding region extract");
            self.enqueue(Job::new_region(id.clone(), geometry, maxzoom, true))
                .await?;
        }
        Ok(())
    }

    /// Spawn the worker tasks. Call once at startup.
    pub fn spawn_workers(self: &Arc<Self>) {
        for worker in 0..self.concurrency {
            let engine = Arc::clone(self);
            tokio::spawn(async move {
                engine.worker_loop(worker).await;
            });
        }
    }

    async fn worker_loop(&self, worker: usize) {
        loop {
            match self.store.claim_next_queued().await {
                Ok(Some(job)) => {
                    tracing::info!(
                        worker,
                        job = job.id,
                        kind = job.kind.as_str(),
                        "job started"
                    );
                    let result = run_job(
                        &job,
                        self.store.as_ref(),
                        self.extractor.as_ref(),
                        &self.paths,
                        self.export_ttl,
                        self.region_ttl,
                    )
                    .await;
                    match result {
                        Ok(()) => tracing::info!(worker, job = job.id, "job done"),
                        Err(e) => tracing::warn!(worker, job = job.id, error = %e, "job failed"),
                    }
                }
                Ok(None) => {
                    tokio::select! {
                        () = self.notify.notified() => {}
                        () = tokio::time::sleep(IDLE_POLL) => {}
                    }
                }
                Err(e) => {
                    tracing::error!(worker, error = %e, "failed to claim job");
                    tokio::time::sleep(StdDuration::from_secs(5)).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{ExtractOutcome, MockPmtilesExtractor};
    use crate::jobs::store::SqliteJobStore;
    use crate::rest::test_util::test_regions;

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
    async fn worker_drains_queue() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = Arc::new(SqliteJobStore::open_in_memory().await.expect("store"));

        let mut extractor = MockPmtilesExtractor::new();
        extractor.expect_extract().returning(|req| {
            std::fs::write(&req.output, b"x").expect("write");
            Ok(ExtractOutcome {
                file_size: 1,
                duration: StdDuration::from_millis(1),
            })
        });

        let engine = JobEngine::new(
            store.clone(),
            Arc::new(extractor),
            paths(dir.path()),
            1,
            Duration::hours(48),
            Duration::hours(48),
        );
        engine.spawn_workers();

        let job = Job::new_custom("t".into(), "{}".into(), 10, 100, "1.1.1.1".into());
        let id = job.id.clone();
        engine.enqueue(job).await.expect("enqueue");

        let mut status = JobStatus::Queued;
        for _ in 0..100 {
            if let Some(job) = store.get(&id).await.expect("get") {
                status = job.status;
                if status == JobStatus::Done {
                    break;
                }
            }
            tokio::time::sleep(StdDuration::from_millis(20)).await;
        }
        assert_eq!(status, JobStatus::Done);
    }

    #[tokio::test]
    async fn seed_enqueues_missing_and_skips_active() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = Arc::new(SqliteJobStore::open_in_memory().await.expect("store"));
        let extractor = Arc::new(MockPmtilesExtractor::new());
        let engine = JobEngine::new(
            store.clone(),
            extractor,
            paths(dir.path()),
            1,
            Duration::hours(48),
            Duration::hours(48),
        );

        let regions = test_regions();
        engine
            .seed(&regions, &["europe".into(), "atlantis".into()], 15)
            .await
            .expect("seed");

        let job = store.get("europe").await.expect("get").expect("job");
        assert_eq!(job.status, JobStatus::Queued);
        assert!(job.pinned);
        assert!(store.get("atlantis").await.expect("get").is_none());

        // Seeding again while queued must not duplicate or replace.
        engine
            .seed(&regions, &["europe".into()], 15)
            .await
            .expect("seed again");
        assert_eq!(store.queued_count().await.expect("count"), 1);
    }

    #[tokio::test]
    async fn recover_requeues_and_expires_lost_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = Arc::new(SqliteJobStore::open_in_memory().await.expect("store"));
        let extractor = Arc::new(MockPmtilesExtractor::new());
        let engine = JobEngine::new(
            store.clone(),
            extractor,
            paths(dir.path()),
            1,
            Duration::hours(48),
            Duration::hours(48),
        );

        // A job that was mid-run.
        store
            .insert(&Job::new_custom(
                "t".into(),
                "{}".into(),
                10,
                100,
                "a".into(),
            ))
            .await
            .expect("insert");
        store.claim_next_queued().await.expect("claim");

        // A done job whose file is gone.
        let mut lost = Job::new_region("europe".into(), "{}".into(), 15, false);
        lost.status = JobStatus::Done;
        lost.file_path = Some(
            dir.path()
                .join("missing.pmtiles")
                .to_string_lossy()
                .into_owned(),
        );
        store.insert(&lost).await.expect("insert");

        engine.recover().await.expect("recover");

        assert_eq!(store.queued_count().await.expect("queued"), 1);
        let lost = store.get("europe").await.expect("get").expect("job");
        assert_eq!(lost.status, JobStatus::Expired);
    }
}
