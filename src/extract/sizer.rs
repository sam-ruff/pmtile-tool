use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use geo::MultiPolygon;
use tokio::process::Command;
use tokio::sync::Semaphore;

use super::ExtractError;
use super::estimate::{Estimate, estimate};
use crate::config::Limits;

const CACHE_CAPACITY: usize = 256;
const CONCURRENT_MEASUREMENTS: usize = 2;
const LOG_TAIL_BYTES: usize = 500;

/// Measures exactly what an extract would contain without writing it.
#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait ExtractSizer: Send + Sync {
    /// `region_geojson` is a GeoJSON Polygon or MultiPolygon.
    async fn measure(&self, region_geojson: String, maxzoom: u8) -> Result<Estimate, ExtractError>;
}

/// Runs `pmtiles extract --dry-run` against the planet archive.
pub struct GoPmtilesSizer {
    binary: PathBuf,
    planet: PathBuf,
    work_dir: PathBuf,
    timeout: Duration,
}

impl GoPmtilesSizer {
    pub fn new(binary: PathBuf, planet: PathBuf, work_dir: PathBuf, timeout: Duration) -> Self {
        Self {
            binary,
            planet,
            work_dir,
            timeout,
        }
    }
}

#[async_trait::async_trait]
impl ExtractSizer for GoPmtilesSizer {
    async fn measure(&self, region_geojson: String, maxzoom: u8) -> Result<Estimate, ExtractError> {
        tokio::fs::create_dir_all(&self.work_dir)
            .await
            .map_err(|e| ExtractError::Io(e.to_string()))?;
        let stem = format!("dry-run-{}", uuid::Uuid::new_v4());
        let region = self.work_dir.join(format!("{stem}.geojson"));
        tokio::fs::write(&region, region_geojson)
            .await
            .map_err(|e| ExtractError::Io(e.to_string()))?;

        let child = Command::new(&self.binary)
            .arg("extract")
            .arg(&self.planet)
            .arg(self.work_dir.join(format!("{stem}.pmtiles")))
            .arg(format!("--region={}", region.display()))
            .arg(format!("--maxzoom={maxzoom}"))
            .arg("--dry-run")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn();
        let result = match child {
            Ok(child) => tokio::time::timeout(self.timeout, child.wait_with_output())
                .await
                .map_err(|_| ExtractError::TimedOut(self.timeout))
                .and_then(|out| out.map_err(|e| ExtractError::Io(e.to_string()))),
            Err(e) => Err(ExtractError::Io(e.to_string())),
        };
        let _ = tokio::fs::remove_file(&region).await;
        let output = result?;

        let log = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if !output.status.success() {
            let log = log.trim();
            let tail_start = log.len().saturating_sub(LOG_TAIL_BYTES);
            return Err(ExtractError::Failed {
                exit_code: output.status.code(),
                stderr_tail: log.get(tail_start..).unwrap_or(log).to_string(),
            });
        }
        parse_dry_run(&log).ok_or_else(|| {
            ExtractError::Io("could not read tile counts from pmtiles dry run".into())
        })
    }
}

/// Pull the region tile count and archive size out of a dry-run log.
pub fn parse_dry_run(log: &str) -> Option<Estimate> {
    let tiles = log.lines().find_map(|line| {
        let rest = line.split("Region tiles ").nth(1)?;
        rest.split(',').next()?.trim().parse::<u64>().ok()
    })?;
    let bytes = log.lines().find_map(|line| {
        let size = line.split("archive size of ").nth(1)?;
        parse_si_bytes(size.trim())
    })?;
    Some(Estimate {
        tiles,
        bytes,
        measured: true,
    })
}

/// Parse go-humanize's SI byte strings such as "24 MB" or "1.3 GB".
fn parse_si_bytes(text: &str) -> Option<u64> {
    let (value, unit) = text.split_once(' ')?;
    let value: f64 = value.parse().ok()?;
    let scale = match unit.trim() {
        "B" => 1.0,
        "kB" => 1e3,
        "MB" => 1e6,
        "GB" => 1e9,
        "TB" => 1e12,
        "PB" => 1e15,
        _ => return None,
    };
    Some((value * scale).round() as u64)
}

/// Sizes export areas, preferring a measurement from the planet archive and
/// falling back to the geometric estimate when one is unavailable.
pub struct SizeEstimator {
    sizer: Option<Arc<dyn ExtractSizer>>,
    cache: Mutex<HashMap<(u64, u8), Estimate>>,
    permits: Semaphore,
}

impl SizeEstimator {
    pub fn new(sizer: Option<Arc<dyn ExtractSizer>>) -> Self {
        Self {
            sizer,
            cache: Mutex::new(HashMap::new()),
            permits: Semaphore::new(CONCURRENT_MEASUREMENTS),
        }
    }

    pub async fn estimate(&self, area: &MultiPolygon, maxzoom: u8, limits: &Limits) -> Estimate {
        let rough = estimate(area, maxzoom, limits.avg_tile_bytes);
        // Areas over the tile cap are refused anyway, so skip the measurement.
        let Some(sizer) = &self.sizer else {
            return rough;
        };
        if rough.tiles > limits.max_estimated_tiles {
            return rough;
        }
        let geometry = geojson::Geometry::new(geojson::GeometryValue::from(area));
        let Ok(geojson) = serde_json::to_string(&geometry) else {
            return rough;
        };
        let key = (hash_of(&geojson), maxzoom);
        if let Some(hit) = self.cached(&key) {
            return hit;
        }
        let Ok(_permit) = self.permits.acquire().await else {
            return rough;
        };
        if let Some(hit) = self.cached(&key) {
            return hit;
        }
        match sizer.measure(geojson, maxzoom).await {
            Ok(measured) => {
                self.remember(key, measured);
                measured
            }
            Err(e) => {
                tracing::warn!(error = %e, "falling back to the geometric size estimate");
                rough
            }
        }
    }

    fn cached(&self, key: &(u64, u8)) -> Option<Estimate> {
        self.cache.lock().ok()?.get(key).copied()
    }

    fn remember(&self, key: (u64, u8), value: Estimate) {
        let Ok(mut cache) = self.cache.lock() else {
            return;
        };
        if cache.len() >= CACHE_CAPACITY {
            cache.clear();
        }
        cache.insert(key, value);
    }
}

fn hash_of(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::{Coord, LineString, Polygon};

    const LONDON_LOG: &str = "\
2026/11/19 17:21:20 extract.go:373: fetching 12 dirs, 12 chunks, 11 requests
2026/11/19 17:21:25 extract.go:413: Region tiles 416, result tile entries 416
2026/11/19 17:21:25 extract.go:422: fetching 416 tiles, 43 chunks, 30 requests
2026/11/19 17:21:25 extract.go:578: Completed in 6.328983238s with 4 download threads (65.72935680076375 tiles/s).
2026/11/19 17:21:25 extract.go:583: Extract required 44 total requests.
2026/11/19 17:21:25 extract.go:584: Extract transferred 25 MB (overfetch 0.05) for an archive size of 24 MB
";

    fn london() -> MultiPolygon {
        let ring = LineString::from(vec![
            Coord { x: -0.3, y: 51.4 },
            Coord { x: 0.1, y: 51.4 },
            Coord { x: 0.1, y: 51.6 },
            Coord { x: -0.3, y: 51.6 },
            Coord { x: -0.3, y: 51.4 },
        ]);
        MultiPolygon(vec![Polygon::new(ring, vec![])])
    }

    #[test]
    fn parses_a_real_dry_run_log() {
        let estimate = parse_dry_run(LONDON_LOG).expect("parsed");
        assert_eq!(estimate.tiles, 416);
        assert_eq!(estimate.bytes, 24_000_000);
        assert!(estimate.measured);
    }

    #[test]
    fn parses_fractional_sizes_and_every_unit() {
        assert_eq!(parse_si_bytes("1.3 GB"), Some(1_300_000_000));
        assert_eq!(parse_si_bytes("82 kB"), Some(82_000));
        assert_eq!(parse_si_bytes("512 B"), Some(512));
        assert_eq!(parse_si_bytes("2.1 TB"), Some(2_100_000_000_000));
        assert_eq!(parse_si_bytes("3 MiB"), None);
    }

    #[test]
    fn a_log_without_counts_is_rejected() {
        assert!(parse_dry_run("2026/11/19 extract.go:1: something else").is_none());
    }

    #[tokio::test]
    async fn uses_the_measurement_and_caches_it() {
        let mut sizer = MockExtractSizer::new();
        sizer.expect_measure().times(1).returning(|_, _| {
            Ok(Estimate {
                tiles: 416,
                bytes: 24_000_000,
                measured: true,
            })
        });
        let estimator = SizeEstimator::new(Some(Arc::new(sizer)));
        let limits = Limits::default();
        let first = estimator.estimate(&london(), 14, &limits).await;
        let second = estimator.estimate(&london(), 14, &limits).await;
        assert_eq!(first.bytes, 24_000_000);
        assert!(first.measured);
        assert_eq!(second.bytes, first.bytes);
    }

    #[tokio::test]
    async fn falls_back_when_the_measurement_fails() {
        let mut sizer = MockExtractSizer::new();
        sizer
            .expect_measure()
            .returning(|_, _| Err(ExtractError::TimedOut(Duration::from_secs(1))));
        let estimator = SizeEstimator::new(Some(Arc::new(sizer)));
        let limits = Limits::default();
        let result = estimator.estimate(&london(), 14, &limits).await;
        assert!(!result.measured);
        assert_eq!(result, estimate(&london(), 14, limits.avg_tile_bytes));
    }

    #[tokio::test]
    async fn skips_measuring_areas_over_the_tile_cap() {
        let mut sizer = MockExtractSizer::new();
        sizer.expect_measure().times(0);
        let estimator = SizeEstimator::new(Some(Arc::new(sizer)));
        let limits = Limits {
            max_estimated_tiles: 10,
            ..Limits::default()
        };
        let result = estimator.estimate(&london(), 14, &limits).await;
        assert!(!result.measured);
        assert!(result.tiles > 10);
    }

    #[tokio::test]
    async fn zoom_is_part_of_the_cache_key() {
        let mut sizer = MockExtractSizer::new();
        sizer.expect_measure().times(2).returning(|_, maxzoom| {
            Ok(Estimate {
                tiles: u64::from(maxzoom),
                bytes: u64::from(maxzoom) * 1000,
                measured: true,
            })
        });
        let estimator = SizeEstimator::new(Some(Arc::new(sizer)));
        let limits = Limits::default();
        let low = estimator.estimate(&london(), 10, &limits).await;
        let high = estimator.estimate(&london(), 12, &limits).await;
        assert_eq!(low.tiles, 10);
        assert_eq!(high.tiles, 12);
    }
}
