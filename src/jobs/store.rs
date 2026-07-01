use std::path::Path;

use chrono::{DateTime, Utc};
use sqlx::Row;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqliteRow};

use super::{Job, JobKind, JobStatus, StatusDetail};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Db(String),
    #[error("job not found: {0}")]
    NotFound(String),
}

impl From<sqlx::Error> for StoreError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(e.to_string())
    }
}

/// Persistence for jobs; doubles as rate-limit accounting and TTL/LRU
/// bookkeeping. Mocked in unit tests, backed by SQLite in production.
#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait JobStore: Send + Sync {
    async fn insert(&self, job: &Job) -> Result<(), StoreError>;
    /// Atomically claim the oldest queued job, moving it to running.
    async fn claim_next_queued(&self) -> Result<Option<Job>, StoreError>;
    async fn update_status(
        &self,
        id: &str,
        status: JobStatus,
        detail: StatusDetail,
    ) -> Result<(), StoreError>;
    async fn get(&self, id: &str) -> Result<Option<Job>, StoreError>;
    async fn count_for_ip_since(&self, ip: &str, since: DateTime<Utc>) -> Result<u32, StoreError>;
    async fn active_for_ip(&self, ip: &str) -> Result<u32, StoreError>;
    async fn queued_count(&self) -> Result<u32, StoreError>;
    async fn running_count(&self) -> Result<u32, StoreError>;
    async fn touch_download(&self, id: &str, at: DateTime<Utc>) -> Result<(), StoreError>;
    /// Done jobs whose expires_at has passed.
    async fn expired_jobs(&self, now: DateTime<Utc>) -> Result<Vec<Job>, StoreError>;
    /// Non-pinned done region jobs, least recently downloaded first.
    async fn evictable_region_jobs(&self) -> Result<Vec<Job>, StoreError>;
    /// All done jobs (startup file verification and cache size accounting).
    async fn done_jobs(&self) -> Result<Vec<Job>, StoreError>;
    /// Move any running jobs back to queued (startup crash recovery).
    async fn requeue_running(&self) -> Result<u32, StoreError>;
    async fn delete(&self, id: &str) -> Result<(), StoreError>;
}

pub struct SqliteJobStore {
    pool: SqlitePool,
}

impl SqliteJobStore {
    /// Open (creating if missing) the SQLite db and run migrations.
    pub async fn open(path: &Path) -> Result<Self, StoreError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePool::connect_with(options).await?;
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|e| StoreError::Db(e.to_string()))?;
        Ok(Self { pool })
    }

    #[cfg(test)]
    pub async fn open_in_memory() -> Result<Self, StoreError> {
        let options = "sqlite::memory:"
            .parse::<SqliteConnectOptions>()
            .map_err(|e| StoreError::Db(e.to_string()))?;
        let pool = SqlitePool::connect_with(options).await?;
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|e| StoreError::Db(e.to_string()))?;
        Ok(Self { pool })
    }
}

fn job_from_row(row: &SqliteRow) -> Result<Job, StoreError> {
    let kind: String = row.try_get("kind")?;
    let status: String = row.try_get("status")?;
    let kind = match kind.as_str() {
        "custom" => JobKind::Custom,
        "region" => JobKind::Region,
        other => return Err(StoreError::Db(format!("unknown job kind: {other}"))),
    };
    let status = match status.as_str() {
        "queued" => JobStatus::Queued,
        "running" => JobStatus::Running,
        "done" => JobStatus::Done,
        "failed" => JobStatus::Failed,
        "expired" => JobStatus::Expired,
        other => return Err(StoreError::Db(format!("unknown job status: {other}"))),
    };
    Ok(Job {
        id: row.try_get("id")?,
        kind,
        status,
        client_ip: row.try_get("client_ip")?,
        region_id: row.try_get("region_id")?,
        geometry: row.try_get("geometry")?,
        maxzoom: row.try_get::<i64, _>("maxzoom")? as u8,
        estimated_tiles: row.try_get::<i64, _>("estimated_tiles")? as u64,
        file_path: row.try_get("file_path")?,
        file_size: row
            .try_get::<Option<i64>, _>("file_size")?
            .map(|v| v as u64),
        error: row.try_get("error")?,
        pinned: row.try_get::<i64, _>("pinned")? != 0,
        created_at: row.try_get("created_at")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        expires_at: row.try_get("expires_at")?,
        last_download_at: row.try_get("last_download_at")?,
    })
}

#[async_trait::async_trait]
impl JobStore for SqliteJobStore {
    async fn insert(&self, job: &Job) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO jobs (id, kind, status, client_ip, region_id, geometry, maxzoom, \
             estimated_tiles, file_path, file_size, error, pinned, created_at, started_at, \
             finished_at, expires_at, last_download_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&job.id)
        .bind(job.kind.as_str())
        .bind(job.status.as_str())
        .bind(&job.client_ip)
        .bind(&job.region_id)
        .bind(&job.geometry)
        .bind(job.maxzoom as i64)
        .bind(job.estimated_tiles as i64)
        .bind(&job.file_path)
        .bind(job.file_size.map(|v| v as i64))
        .bind(&job.error)
        .bind(job.pinned as i64)
        .bind(job.created_at)
        .bind(job.started_at)
        .bind(job.finished_at)
        .bind(job.expires_at)
        .bind(job.last_download_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn claim_next_queued(&self) -> Result<Option<Job>, StoreError> {
        let row = sqlx::query(
            "UPDATE jobs SET status = 'running', started_at = ? \
             WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1) \
             RETURNING *",
        )
        .bind(Utc::now())
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(job_from_row).transpose()
    }

    async fn update_status(
        &self,
        id: &str,
        status: JobStatus,
        detail: StatusDetail,
    ) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE jobs SET status = ?, \
             error = COALESCE(?, error), \
             file_path = COALESCE(?, file_path), \
             file_size = COALESCE(?, file_size), \
             started_at = COALESCE(?, started_at), \
             finished_at = COALESCE(?, finished_at), \
             expires_at = COALESCE(?, expires_at) \
             WHERE id = ?",
        )
        .bind(status.as_str())
        .bind(&detail.error)
        .bind(&detail.file_path)
        .bind(detail.file_size.map(|v| v as i64))
        .bind(detail.started_at)
        .bind(detail.finished_at)
        .bind(detail.expires_at)
        .bind(id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    async fn get(&self, id: &str) -> Result<Option<Job>, StoreError> {
        let row = sqlx::query("SELECT * FROM jobs WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(job_from_row).transpose()
    }

    async fn count_for_ip_since(&self, ip: &str, since: DateTime<Utc>) -> Result<u32, StoreError> {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE client_ip = ? AND created_at >= ?")
                .bind(ip)
                .bind(since)
                .fetch_one(&self.pool)
                .await?;
        Ok(count as u32)
    }

    async fn active_for_ip(&self, ip: &str) -> Result<u32, StoreError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM jobs WHERE client_ip = ? AND status IN ('queued', 'running')",
        )
        .bind(ip)
        .fetch_one(&self.pool)
        .await?;
        Ok(count as u32)
    }

    async fn queued_count(&self) -> Result<u32, StoreError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE status = 'queued'")
            .fetch_one(&self.pool)
            .await?;
        Ok(count as u32)
    }

    async fn running_count(&self) -> Result<u32, StoreError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE status = 'running'")
            .fetch_one(&self.pool)
            .await?;
        Ok(count as u32)
    }

    async fn touch_download(&self, id: &str, at: DateTime<Utc>) -> Result<(), StoreError> {
        sqlx::query("UPDATE jobs SET last_download_at = ? WHERE id = ?")
            .bind(at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn expired_jobs(&self, now: DateTime<Utc>) -> Result<Vec<Job>, StoreError> {
        let rows = sqlx::query(
            "SELECT * FROM jobs WHERE status = 'done' AND expires_at IS NOT NULL AND expires_at <= ?",
        )
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(job_from_row).collect()
    }

    async fn evictable_region_jobs(&self) -> Result<Vec<Job>, StoreError> {
        let rows = sqlx::query(
            "SELECT * FROM jobs WHERE kind = 'region' AND status = 'done' AND pinned = 0 \
             ORDER BY COALESCE(last_download_at, finished_at, created_at) ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(job_from_row).collect()
    }

    async fn done_jobs(&self) -> Result<Vec<Job>, StoreError> {
        let rows = sqlx::query("SELECT * FROM jobs WHERE status = 'done'")
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(job_from_row).collect()
    }

    async fn requeue_running(&self) -> Result<u32, StoreError> {
        let result = sqlx::query(
            "UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'",
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() as u32)
    }

    async fn delete(&self, id: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM jobs WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom_job(ip: &str) -> Job {
        Job::new_custom("{}".into(), 10, 1000, ip.into())
    }

    #[tokio::test]
    async fn insert_get_roundtrip() {
        let store = SqliteJobStore::open_in_memory().await.expect("open");
        let job = custom_job("1.2.3.4");
        store.insert(&job).await.expect("insert");

        let loaded = store.get(&job.id).await.expect("get").expect("present");
        assert_eq!(loaded.id, job.id);
        assert_eq!(loaded.kind, JobKind::Custom);
        assert_eq!(loaded.status, JobStatus::Queued);
        assert_eq!(loaded.client_ip.as_deref(), Some("1.2.3.4"));
        assert_eq!(loaded.maxzoom, 10);
        assert_eq!(loaded.estimated_tiles, 1000);
        assert!(!loaded.pinned);
    }

    #[tokio::test]
    async fn claim_is_fifo_and_moves_to_running() {
        let store = SqliteJobStore::open_in_memory().await.expect("open");
        let mut first = custom_job("a");
        first.created_at = Utc::now() - chrono::Duration::minutes(2);
        let second = custom_job("b");
        store.insert(&first).await.expect("insert");
        store.insert(&second).await.expect("insert");

        let claimed = store
            .claim_next_queued()
            .await
            .expect("claim")
            .expect("job");
        assert_eq!(claimed.id, first.id);
        assert_eq!(claimed.status, JobStatus::Running);
        assert!(claimed.started_at.is_some());

        let claimed = store
            .claim_next_queued()
            .await
            .expect("claim")
            .expect("job");
        assert_eq!(claimed.id, second.id);
        assert!(store.claim_next_queued().await.expect("claim").is_none());
    }

    #[tokio::test]
    async fn update_status_merges_detail() {
        let store = SqliteJobStore::open_in_memory().await.expect("open");
        let job = custom_job("a");
        store.insert(&job).await.expect("insert");

        let now = Utc::now();
        store
            .update_status(
                &job.id,
                JobStatus::Done,
                StatusDetail {
                    file_path: Some("/data/exports/x.pmtiles".into()),
                    file_size: Some(42),
                    finished_at: Some(now),
                    expires_at: Some(now + chrono::Duration::hours(48)),
                    ..Default::default()
                },
            )
            .await
            .expect("update");

        let loaded = store.get(&job.id).await.expect("get").expect("present");
        assert_eq!(loaded.status, JobStatus::Done);
        assert_eq!(loaded.file_size, Some(42));
        assert!(loaded.expires_at.is_some());
        assert!(loaded.error.is_none());
    }

    #[tokio::test]
    async fn quota_counts() {
        let store = SqliteJobStore::open_in_memory().await.expect("open");
        store.insert(&custom_job("a")).await.expect("insert");
        store.insert(&custom_job("a")).await.expect("insert");
        store.insert(&custom_job("b")).await.expect("insert");

        let hour_ago = Utc::now() - chrono::Duration::hours(1);
        assert_eq!(
            store
                .count_for_ip_since("a", hour_ago)
                .await
                .expect("count"),
            2
        );
        assert_eq!(store.active_for_ip("a").await.expect("active"), 2);
        assert_eq!(store.queued_count().await.expect("queued"), 3);
        assert_eq!(store.running_count().await.expect("running"), 0);
    }

    #[tokio::test]
    async fn expiry_and_eviction_queries() {
        let store = SqliteJobStore::open_in_memory().await.expect("open");
        let now = Utc::now();

        let mut expired = custom_job("a");
        expired.status = JobStatus::Done;
        expired.expires_at = Some(now - chrono::Duration::hours(1));
        store.insert(&expired).await.expect("insert");

        let mut pinned_region = Job::new_region("europe".into(), "{}".into(), 15, true);
        pinned_region.status = JobStatus::Done;
        store.insert(&pinned_region).await.expect("insert");

        let mut lazy_region = Job::new_region("england".into(), "{}".into(), 15, false);
        lazy_region.status = JobStatus::Done;
        store.insert(&lazy_region).await.expect("insert");

        let expired_jobs = store.expired_jobs(now).await.expect("expired");
        assert_eq!(expired_jobs.len(), 1);
        assert_eq!(expired_jobs[0].id, expired.id);

        let evictable = store.evictable_region_jobs().await.expect("evictable");
        assert_eq!(evictable.len(), 1);
        assert_eq!(evictable[0].id, "england");
    }

    #[tokio::test]
    async fn requeue_running_recovers() {
        let store = SqliteJobStore::open_in_memory().await.expect("open");
        store.insert(&custom_job("a")).await.expect("insert");
        store
            .claim_next_queued()
            .await
            .expect("claim")
            .expect("job");

        assert_eq!(store.requeue_running().await.expect("requeue"), 1);
        assert_eq!(store.queued_count().await.expect("queued"), 1);
    }
}
