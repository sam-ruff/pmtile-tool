use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::Duration;
use pmtile_tool::config::AppConfig;
use pmtile_tool::extract::GoPmtilesExtractor;
use pmtile_tool::jobs::cleanup::spawn_sweeper;
use pmtile_tool::jobs::engine::JobEngine;
use pmtile_tool::jobs::runner::RunnerPaths;
use pmtile_tool::jobs::store::SqliteJobStore;
use pmtile_tool::martin_embed::{HttpTileBackend, start_martin};
use pmtile_tool::regions::RegionCatalog;
use pmtile_tool::rest::build_router;
use pmtile_tool::state::AppContext;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config.yaml".into());
    let config = AppConfig::load(Path::new(&config_path))?;
    config.ensure_dirs()?;

    let planet = config.planet_path();
    if !planet.exists() {
        return Err(format!(
            "planet archive not found at {} - run scripts/dev-data.sh to fetch a small dev extract",
            planet.display()
        )
        .into());
    }

    let regions = Arc::new(RegionCatalog::load(&config.regions_index)?);
    tracing::info!("loaded {} regions", regions.len());

    let store = Arc::new(SqliteJobStore::open(&config.db_path()).await?);
    let extractor = Arc::new(GoPmtilesExtractor::new(
        config.go_pmtiles_bin.clone(),
        StdDuration::from_secs(config.limits.extract_timeout_minutes * 60),
    ));
    let engine = JobEngine::new(
        store.clone(),
        extractor,
        RunnerPaths::from_config(&config),
        config.limits.max_concurrent_extracts,
        Duration::hours(config.retention.export_ttl_hours),
        Duration::hours(config.retention.region_ttl_hours),
    );
    engine.recover().await?;
    engine.spawn_workers();
    engine
        .seed(
            &regions,
            &config.seed_regions,
            config.limits.max_maxzoom,
            config.limits.avg_tile_bytes,
        )
        .await?;
    spawn_sweeper(
        store.clone(),
        config.exports_dir(),
        config.region_cache_dir(),
        config.limits.data_budget_gb,
    );

    let (martin_server, martin_addr) = start_martin(&config).await?;
    tracing::info!("embedded martin listening on {martin_addr}");

    let backend = Arc::new(HttpTileBackend::new(format!("http://{martin_addr}")));
    let listener = tokio::net::TcpListener::bind(&config.listen).await?;
    tracing::info!("listening on {}", config.listen);

    let ctx = AppContext::new(config, backend, regions, store, engine);
    let app = build_router(ctx);

    // The martin future is !Send, so both servers are awaited on this task.
    tokio::select! {
        result = martin_server => {
            result?;
            Err("embedded martin server exited unexpectedly".into())
        }
        result = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        ) => {
            result?;
            Ok(())
        }
    }
}
