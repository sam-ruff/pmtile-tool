use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::Utc;

use super::store::{JobStore, StoreError};
use super::{JobStatus, StatusDetail};

const SWEEP_INTERVAL: StdDuration = StdDuration::from_secs(300);
pub const GIB: u64 = 1024 * 1024 * 1024;

/// Evict done custom exports (least recently downloaded first) until the
/// exports dir plus `incoming_bytes` fits the budget. Lets a burst of new
/// export requests push old files out instead of being refused.
pub async fn evict_exports_to_fit(
    store: &dyn JobStore,
    exports_dir: &Path,
    budget_bytes: u64,
    incoming_bytes: u64,
) -> Result<usize, StoreError> {
    let mut size = crate::disk::dir_size(exports_dir).unwrap_or(0);
    if size.saturating_add(incoming_bytes) <= budget_bytes {
        return Ok(0);
    }
    let mut evicted = 0;
    for job in store.evictable_custom_jobs().await? {
        if size.saturating_add(incoming_bytes) <= budget_bytes {
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
        size = size.saturating_sub(file_size);
        evicted += 1;
    }
    Ok(evicted)
}

#[derive(Debug, Default, PartialEq)]
pub struct SweepReport {
    pub expired: usize,
    pub evicted: usize,
    pub orphan_files_removed: usize,
    pub lost_files_marked: usize,
}

/// One sweep: expire TTL'd exports, evict least-recently-used region files
/// when the cache exceeds its budget, and reconcile db rows vs files on disk.
pub async fn sweep_once(
    store: &dyn JobStore,
    exports_dir: &Path,
    region_cache_dir: &Path,
    region_cache_max_gb: u64,
    exports_max_gb: u64,
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

    // LRU eviction when the region cache exceeds its budget.
    let budget = region_cache_max_gb.saturating_mul(GIB);
    let mut cache_size = crate::disk::dir_size(region_cache_dir).unwrap_or(0);
    if cache_size > budget {
        for job in store.evictable_region_jobs().await? {
            if cache_size <= budget {
                break;
            }
            let Some(path) = job.file_path.clone() else {
                continue;
            };
            let size = tokio::fs::metadata(&path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            let _ = tokio::fs::remove_file(&path).await;
            store
                .update_status(&job.id, JobStatus::Expired, StatusDetail::default())
                .await?;
            cache_size = cache_size.saturating_sub(size);
            report.evicted += 1;
        }
    }

    report.evicted +=
        evict_exports_to_fit(store, exports_dir, exports_max_gb.saturating_mul(GIB), 0).await?;

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
    region_cache_max_gb: u64,
    exports_max_gb: u64,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(SWEEP_INTERVAL);
        loop {
            interval.tick().await;
            match sweep_once(
                store.as_ref(),
                &exports_dir,
                &region_cache_dir,
                region_cache_max_gb,
                exports_max_gb,
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
            JobKind::Region => Job::new_region(id.into(), "{}".into(), 15, pinned),
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

        let report = sweep_once(&store, &exports, &cache, 200, 20)
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
        let report = sweep_once(&store, &exports, &cache, 0, 20)
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
        std::fs::create_dir_all(&exports).expect("dirs");
        let store = SqliteJobStore::open_in_memory().await.expect("store");

        let oldest = done_job(&store, "first", JobKind::Custom, &exports, Some(24), false).await;
        done_job(&store, "second", JobKind::Custom, &exports, Some(24), false).await;
        store
            .touch_download("second", Utc::now())
            .await
            .expect("touch");

        // Two 10-byte files on disk; an incoming 15-byte job against a
        // 25-byte budget must evict exactly the least recently used one.
        let evicted = evict_exports_to_fit(&store, &exports, 25, 15)
            .await
            .expect("evict");
        assert_eq!(evicted, 1);
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
        let evicted = evict_exports_to_fit(&store, &exports, 25, 5)
            .await
            .expect("evict");
        assert_eq!(evicted, 0);
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

        let report = sweep_once(&store, &exports, &cache, 200, 20)
            .await
            .expect("sweep");
        assert_eq!(report.lost_files_marked, 1);
        assert_eq!(report.orphan_files_removed, 1);
        assert!(!exports.join("orphan.pmtiles").exists());
    }
}
