use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Application configuration, loaded from a YAML file with sensible defaults
/// so the binary also runs with no config file at all (dev mode).
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AppConfig {
    /// Public listen address for the axum app.
    pub listen: String,
    /// Loopback listen address for the embedded martin tile server.
    pub martin_listen: String,
    /// Directory holding planet.pmtiles, exports/, region-cache/, work/ and the job db.
    pub data_dir: PathBuf,
    /// Path to the go-pmtiles binary used for extracts.
    pub go_pmtiles_bin: PathBuf,
    /// Vendored Geofabrik index with region hierarchy and geometries.
    pub regions_index: PathBuf,
    /// Region ids extracted at startup and pinned (never evicted).
    pub seed_regions: Vec<String>,
    pub limits: Limits,
    pub retention: Retention,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Limits {
    pub max_maxzoom: u8,
    pub max_estimated_tiles: u64,
    /// Hard ceiling on a single custom export's estimated size.
    pub max_custom_export_gb: u64,
    pub max_polygon_vertices: usize,
    pub jobs_per_ip_per_hour: u32,
    pub active_jobs_per_ip: u32,
    pub queue_depth_max: u32,
    pub max_concurrent_extracts: usize,
    pub extract_timeout_minutes: u64,
    /// Average bytes per tile used for size estimates (derived from planet build).
    pub avg_tile_bytes: u64,
    /// Aggressive limiter on job-creating endpoints.
    pub job_rate_limit_per_second: u64,
    pub job_rate_limit_burst: u32,
    /// Laxer limiter on downloads and estimates; ranged preview reads are chatty.
    pub download_rate_limit_per_second: u64,
    pub download_rate_limit_burst: u32,
    /// Total disk budget for all writable extracts (custom exports plus cached
    /// regions) excluding the planet archive. New jobs evict the least recently
    /// used finished outputs to stay within it, so the footprint is bounded.
    pub data_budget_gb: u64,
}

impl Limits {
    /// The writable-data budget in bytes.
    pub fn data_budget_bytes(&self) -> u64 {
        self.data_budget_gb
            .saturating_mul(crate::jobs::cleanup::GIB)
    }

    /// The per-export size ceiling in bytes.
    pub fn max_custom_export_bytes(&self) -> u64 {
        self.max_custom_export_gb
            .saturating_mul(crate::jobs::cleanup::GIB)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Retention {
    pub export_ttl_hours: i64,
    pub region_ttl_hours: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            listen: "0.0.0.0:8080".into(),
            martin_listen: "127.0.0.1:3111".into(),
            data_dir: PathBuf::from("data"),
            go_pmtiles_bin: PathBuf::from("pmtiles"),
            regions_index: PathBuf::from("assets/geofabrik-index-v1.json"),
            seed_regions: Vec::new(),
            limits: Limits::default(),
            retention: Retention::default(),
        }
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_maxzoom: 15,
            max_estimated_tiles: 150_000_000,
            max_custom_export_gb: 10,
            max_polygon_vertices: 1000,
            jobs_per_ip_per_hour: 5,
            active_jobs_per_ip: 2,
            queue_depth_max: 20,
            max_concurrent_extracts: 1,
            extract_timeout_minutes: 60,
            avg_tile_bytes: 85,
            job_rate_limit_per_second: 1,
            job_rate_limit_burst: 3,
            download_rate_limit_per_second: 20,
            download_rate_limit_burst: 100,
            data_budget_gb: 70,
        }
    }
}

impl Default for Retention {
    fn default() -> Self {
        Self {
            export_ttl_hours: 48,
            region_ttl_hours: 48,
        }
    }
}

impl AppConfig {
    /// Load from a YAML file; a missing file yields the defaults.
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(path)
            .map_err(|e| ConfigError::Io(path.to_path_buf(), e.to_string()))?;
        serde_yaml::from_str(&raw)
            .map_err(|e| ConfigError::Parse(path.to_path_buf(), e.to_string()))
    }

    pub fn planet_path(&self) -> PathBuf {
        self.data_dir.join("planet.pmtiles")
    }

    pub fn exports_dir(&self) -> PathBuf {
        self.data_dir.join("exports")
    }

    pub fn region_cache_dir(&self) -> PathBuf {
        self.data_dir.join("region-cache")
    }

    pub fn work_dir(&self) -> PathBuf {
        self.data_dir.join("work")
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("db").join("pmtile-tool.sqlite")
    }

    /// Create the writable data subdirectories if they do not exist.
    pub fn ensure_dirs(&self) -> Result<(), ConfigError> {
        for dir in [
            self.exports_dir(),
            self.region_cache_dir(),
            self.work_dir(),
            self.data_dir.join("db"),
        ] {
            fs::create_dir_all(&dir).map_err(|e| ConfigError::Io(dir.clone(), e.to_string()))?;
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to read {0}: {1}")]
    Io(PathBuf, String),
    #[error("failed to parse {0}: {1}")]
    Parse(PathBuf, String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_file_missing() {
        let cfg = AppConfig::load(Path::new("does-not-exist.yaml")).expect("defaults");
        assert_eq!(cfg.listen, "0.0.0.0:8080");
        assert_eq!(cfg.limits.max_maxzoom, 15);
        assert_eq!(cfg.retention.export_ttl_hours, 48);
    }

    #[test]
    fn loads_partial_yaml_over_defaults() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("config.yaml");
        fs::write(
            &path,
            "data_dir: /data\nlimits:\n  jobs_per_ip_per_hour: 9\n",
        )
        .expect("write");
        let cfg = AppConfig::load(&path).expect("load");
        assert_eq!(cfg.data_dir, PathBuf::from("/data"));
        assert_eq!(cfg.limits.jobs_per_ip_per_hour, 9);
        assert_eq!(cfg.limits.active_jobs_per_ip, 2);
        assert_eq!(cfg.planet_path(), PathBuf::from("/data/planet.pmtiles"));
    }

    #[test]
    fn rejects_unknown_fields() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("config.yaml");
        fs::write(&path, "not_a_field: true\n").expect("write");
        assert!(AppConfig::load(&path).is_err());
    }
}
