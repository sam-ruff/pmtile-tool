use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::Utc;

use super::store::{JobStore, StoreError};
use super::{JobStatus, StatusDetail};

const SWEEP_INTERVAL: StdDuration = StdDuration::from_secs(300);
pub const GIB: u64 = 1024 * 1024 * 1024;

/// Result of an eviction pass.
#[derive(Debug, Default, PartialEq)]
pub struct EvictOutcome {
    /// Number of finished outputs deleted to make room.
    pub evicted: usize,
    /// Whether the committed footprint fits the budget after evicting.
    pub fits: bool,
}

/// Evict finished outputs (custom exports and non-pinned region caches),
/// least recently used first across both pools, until the on-disk footprint
/// plus in-flight reservations and this job's `incoming_bytes` fits the budget.
///
/// `reserved_bytes` covers queued/running jobs whose output is not yet on disk,
/// so concurrent work cannot over-commit the budget. A burst of new jobs pushes
/// old files out rather than being refused; only a job that cannot fit even
/// after evicting everything evictable comes back with `fits == false`.
pub async fn evict_to_fit(
    store: &dyn JobStore,
    exports_dir: &Path,
    region_cache_dir: &Path,
    budget_bytes: u64,
    reserved_bytes: u64,
    incoming_bytes: u64,
) -> Result<EvictOutcome, StoreError> {
    let mut on_disk = crate::disk::dir_size(exports_dir).unwrap_or(0)
        + crate::disk::dir_size(region_cache_dir).unwrap_or(0);
    let committed = |on_disk: u64| {
        on_disk
            .saturating_add(reserved_bytes)
            .saturating_add(incoming_bytes)
    };
    if committed(on_disk) <= budget_bytes {
        return Ok(EvictOutcome {
            evicted: 0,
            fits: true,
        });
    }
    let mut evicted = 0;
    for job in store.evictable_jobs().await? {
        if committed(on_disk) <= budget_bytes {
            break;
        }
        let Some(path) = job.file_path.clone() else {
            continue;
        };
        let file_size = tokio::fs::metadata(&path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        let _ = tokio::fs::remove_file(&path).await;
        store
            .update_status(&job.id, JobStatus::Expired, StatusDetail::default())
            .await?;
        on_disk = on_disk.saturating_sub(file_size);
        evicted += 1;
    }
    Ok(EvictOutcome {
        evicted,
        fits: committed(on_disk) <= budget_bytes,
    })
}

#[derive(Debug, Default, PartialEq)]
pub struct SweepReport {
    pub expired: usize,
    pub evicted: usize,
    pub orphan_files_removed: usize,
    pub lost_files_marked: usize,
}

/// One sweep: expire TTL'd exports, evict least-recently-used finished outputs
/// when the combined writable footprint exceeds the budget, and reconcile db
/// rows vs files on disk. This is the periodic backstop for the reservation
/// accounting done at job-creation time.
pub async fn sweep_once(
    store: &dyn JobStore,
    exports_dir: &Path,
    region_cache_dir: &Path,
    data_budget_gb: u64,
) -> Result<SweepReport, StoreError> {
    let mut report = SweepReport::default();
    let now = Utc::now();

    for job in store.expired_jobs(now).await? {
        if let Some(path) = &job.file_path {
            let _ = tokio::fs::remove_file(path).await;
        }
        store
            .update_status(&job.id, JobStatus::Expired, StatusDetail::default())
            .await?;
        report.expired += 1;
    }

    // Enforce the combined budget against what is actually on disk.
    let outcome = evict_to_fit(
        store,
        exports_dir,
        region_cache_dir,
        data_budget_gb.saturating_mul(GIB),
        0,
        0,
    )
    .await?;
    report.evicted += outcome.evicted;

    // Reconcile: done rows must have files; files must have done rows.
    let done = store.done_jobs().await?;
    let mut known_files: HashSet<String> = HashSet::new();
    for job in &done {
        match &job.file_path {
            Some(path) if Path::new(path).exists() => {
                known_files.insert(path.clone());
            }
            _ => {
                store
                    .update_status(&job.id, JobStatus::Expired, StatusDetail::default())
                    .await?;
                report.lost_files_marked += 1;
            }
        }
    }
    for dir in [exports_dir, region_cache_dir] {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_archive = path.extension().is_some_and(|e| e == "pmtiles");
            if !is_archive {
                continue;
            }
            if !known_files.contains(&path.to_string_lossy().into_owned()) {
                let _ = std::fs::remove_file(&path);
                report.orphan_files_removed += 1;
            }
        }
    }

    Ok(report)
}

/// Spawn the periodic sweeper task.
pub fn spawn_sweeper(
    store: Arc<dyn JobStore>,
    exports_dir: std::path::PathBuf,
    region_cache_dir: std::path::PathBuf,
    data_budget_gb: u64,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(SWEEP_INTERVAL);
        loop {
            interval.tick().await;
            match sweep_once(
                store.as_ref(),
                &exports_dir,
                &region_cache_dir,
                data_budget_gb,
            )
            .await
            {
                Ok(report) if report != SweepReport::default() => {
                    tracing::info!(
                        expired = report.expired,
                        evicted = report.evicted,
                        orphans = report.orphan_files_removed,
                        lost = report.lost_files_marked,
                        "sweep complete"
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "sweep failed"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::store::SqliteJobStore;
    use crate::jobs::{Job, JobKind};
    use chrono::Duration;

    async fn done_job(
        store: &SqliteJobStore,
        id: &str,
        kind: JobKind,
        dir: &Path,
        expires_in_hours: Option<i64>,
        pinned: bool,
    ) -> String {
        let path = dir.join(format!("{id}.pmtiles"));
        std::fs::write(&path, vec![0u8; 10]).expect("write file");
        let mut job = match kind {
            JobKind::Custom => Job::new_custom(id.into(), "{}".into(), 10, 1, "ip".into()),
            JobKind::Region => Job::new_region(id.into(), "{}".into(), 15, 1, pinned),
        };
        if kind == JobKind::Custom {
            job.id = id.to_string();
        }
        job.status = JobStatus::Done;
        job.file_path = Some(path.to_string_lossy().into_owned());
        job.file_size = Some(10);
        job.expires_at = expires_in_hours.map(|h| Utc::now() + Duration::hours(h));
        store.insert(&job).await.expect("insert");
        path.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn expires_ttl_jobs_and_removes_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exports = dir.path().join("exports");
        let cache = dir.path().join("region-cache");
        std::fs::create_dir_all(&exports).expect("dirs");
        std::fs::create_dir_all(&cache).expect("dirs");
        let store = SqliteJobStore::open_in_memory().await.expect("store");

        let expired_path =
            done_job(&store, "old", JobKind::Custom, &exports, Some(-1), false).await;
        done_job(&store, "fresh", JobKind::Custom, &exports, Some(24), false).await;

        let report = sweep_once(&store, &exports, &cache, 200)
            .await
            .expect("sweep");
        assert_eq!(report.expired, 1);
        assert!(!Path::new(&expired_path).exists());
        assert_eq!(
            store.get("old").await.expect("get").expect("job").status,
            JobStatus::Expired
        );
        assert_eq!(
            store.get("fresh").await.expect("get").expect("job").status,
            JobStatus::Done
        );
    }

    #[tokio::test]
    async fn evicts_lru_regions_over_budget() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exports = dir.path().join("exports");
        let cache = dir.path().join("region-cache");
        std::fs::create_dir_all(&exports).expect("dirs");
        std::fs::create_dir_all(&cache).expect("dirs");
        let store = SqliteJobStore::open_in_memory().await.expect("store");

        done_job(&store, "europe", JobKind::Region, &cache, None, true).await;
        let old = done_job(&store, "england", JobKind::Region, &cache, None, false).await;
        done_job(&store, "wales", JobKind::Region, &cache, None, false).await;
        store
            .touch_download("wales", Utc::now())
            .await
            .expect("touch");

        // Budget zero forces eviction of everything evictable, oldest first;
        // the pinned europe file must survive.
        let report = sweep_once(&store, &exports, &cache, 0)
            .await
            .expect("sweep");
        assert!(report.evicted >= 1);
        assert!(!Path::new(&old).exists());
        assert_eq!(
            store.get("europe").await.expect("get").expect("job").status,
            JobStatus::Done
        );
    }

    #[tokio::test]
    async fn new_exports_push_out_least_recently_downloaded() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exports = dir.path().join("exports");
        let cache = dir.path().join("region-cache");
        std::fs::create_dir_all(&exports).expect("dirs");
        std::fs::create_dir_all(&cache).expect("dirs");
        let store = SqliteJobStore::open_in_memory().await.expect("store");

        let oldest = done_job(&store, "first", JobKind::Custom, &exports, Some(24), false).await;
        done_job(&store, "second", JobKind::Custom, &exports, Some(24), false).await;
        store
            .touch_download("second", Utc::now())
            .await
            .expect("touch");

        // Two 10-byte files on disk; an incoming 15-byte job against a
        // 25-byte budget must evict exactly the least recently used one.
        let outcome = evict_to_fit(&store, &exports, &cache, 25, 0, 15)
            .await
            .expect("evict");
        assert_eq!(outcome.evicted, 1);
        assert!(outcome.fits);
        assert!(!Path::new(&oldest).exists());
        assert_eq!(
            store.get("first").await.expect("get").expect("job").status,
            JobStatus::Expired
        );
        assert_eq!(
            store.get("second").await.expect("get").expect("job").status,
            JobStatus::Done
        );

        // Fits without eviction: nothing else is touched.
        let outcome = evict_to_fit(&store, &exports, &cache, 25, 0, 5)
            .await
            .expect("evict");
        assert_eq!(outcome.evicted, 0);
        assert!(outcome.fits);
    }

    #[tokio::test]
    async fn evicts_across_both_pools_and_reports_no_fit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exports = dir.path().join("exports");
        let cache = dir.path().join("region-cache");
        std::fs::create_dir_all(&exports).expect("dirs");
        std::fs::create_dir_all(&cache).expect("dirs");
        let store = SqliteJobStore::open_in_memory().await.expect("store");

        // One finished export and one non-pinned region, plus a pinned seed.
        let export = done_job(&store, "exp", JobKind::Custom, &exports, Some(24), false).await;
        let region = done_job(&store, "england", JobKind::Region, &cache, None, false).await;
        let pinned = done_job(&store, "europe", JobKind::Region, &cache, None, true).await;
        store
            .touch_download("england", Utc::now())
            .await
            .expect("touch");

        // 30 bytes on disk across the pools; a 25-byte budget with a 20-byte
        // reservation must evict from both pools, oldest first, and the pinned
        // seed must survive even though that leaves the job unable to fit.
        let outcome = evict_to_fit(&store, &exports, &cache, 25, 20, 0)
            .await
            .expect("evict");
        assert_eq!(outcome.evicted, 2);
        assert!(!outcome.fits);
        assert!(!Path::new(&export).exists());
        assert!(!Path::new(&region).exists());
        assert!(Path::new(&pinned).exists());
        assert_eq!(
            store.get("europe").await.expect("get").expect("job").status,
            JobStatus::Done
        );
    }

    #[tokio::test]
    async fn reconciles_orphans_both_ways() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exports = dir.path().join("exports");
        let cache = dir.path().join("region-cache");
        std::fs::create_dir_all(&exports).expect("dirs");
        std::fs::create_dir_all(&cache).expect("dirs");
        let store = SqliteJobStore::open_in_memory().await.expect("store");

        // Row whose file vanished.
        let lost = done_job(&store, "lost", JobKind::Custom, &exports, Some(24), false).await;
        std::fs::remove_file(&lost).expect("remove");
        // File with no row.
        std::fs::write(exports.join("orphan.pmtiles"), b"x").expect("write");

        let report = sweep_once(&store, &exports, &cache, 200)
            .await
            .expect("sweep");
        assert_eq!(report.lost_files_marked, 1);
        assert_eq!(report.orphan_files_removed, 1);
        assert!(!exports.join("orphan.pmtiles").exists());
    }
}
