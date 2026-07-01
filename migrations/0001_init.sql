CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('custom', 'region')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'expired')),
    client_ip TEXT,
    region_id TEXT,
    geometry TEXT NOT NULL,
    maxzoom INTEGER NOT NULL,
    estimated_tiles INTEGER NOT NULL DEFAULT 0,
    file_path TEXT,
    file_size INTEGER,
    error TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    expires_at TEXT,
    last_download_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_ip_created ON jobs (client_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_kind_pinned_download ON jobs (kind, pinned, last_download_at);
