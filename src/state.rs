use std::sync::Arc;

use crate::config::AppConfig;
use crate::jobs::engine::JobEngine;
use crate::jobs::store::JobStore;
use crate::martin_embed::TileBackend;
use crate::regions::RegionCatalog;

/// Shared handler state. Cheap to clone.
#[derive(Clone)]
pub struct AppContext {
    pub config: Arc<AppConfig>,
    pub tiles: Arc<dyn TileBackend>,
    pub regions: Arc<RegionCatalog>,
    pub store: Arc<dyn JobStore>,
    pub engine: Arc<JobEngine>,
}

impl AppContext {
    pub fn new(
        config: AppConfig,
        tiles: Arc<dyn TileBackend>,
        regions: Arc<RegionCatalog>,
        store: Arc<impl JobStore + 'static>,
        engine: Arc<JobEngine>,
    ) -> Self {
        Self {
            config: Arc::new(config),
            tiles,
            regions,
            store,
            engine,
        }
    }
}
