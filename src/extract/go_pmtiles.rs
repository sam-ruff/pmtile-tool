use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::process::Command;

use super::{ExtractError, ExtractOutcome, ExtractRequest, PmtilesExtractor};

const STDERR_TAIL_CHARS: usize = 2000;

/// Runs `pmtiles extract` as a subprocess.
pub struct GoPmtilesExtractor {
    binary: PathBuf,
    timeout: Duration,
}

impl GoPmtilesExtractor {
    pub fn new(binary: PathBuf, timeout: Duration) -> Self {
        Self { binary, timeout }
    }
}

#[async_trait::async_trait]
impl PmtilesExtractor for GoPmtilesExtractor {
    async fn extract(&self, req: &ExtractRequest) -> Result<ExtractOutcome, ExtractError> {
        let started = Instant::now();
        let child = Command::new(&self.binary)
            .arg("extract")
            .arg(&req.planet)
            .arg(&req.output)
            .arg(format!("--region={}", req.region_geojson.display()))
            .arg(format!("--maxzoom={}", req.maxzoom))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ExtractError::Io(e.to_string()))?;

        let output = tokio::time::timeout(self.timeout, child.wait_with_output())
            .await
            .map_err(|_| ExtractError::TimedOut(self.timeout))?
            .map_err(|e| ExtractError::Io(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail_start = stderr.len().saturating_sub(STDERR_TAIL_CHARS);
            let stderr_tail = stderr
                .get(tail_start..)
                .unwrap_or(&stderr)
                .trim()
                .to_string();
            return Err(ExtractError::Failed {
                exit_code: output.status.code(),
                stderr_tail,
            });
        }

        let file_size = tokio::fs::metadata(&req.output)
            .await
            .map_err(|e| ExtractError::Io(format!("output missing after extract: {e}")))?
            .len();
        Ok(ExtractOutcome {
            file_size,
            duration: started.elapsed(),
        })
    }
}
