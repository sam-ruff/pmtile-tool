use std::sync::Arc;

use crate::config::AppConfig;
use crate::extract::sizer::{ExtractSizer, SizeEstimator};
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
    pub sizes: Arc<SizeEstimator>,
}

impl AppContext {
    /// Sizes are approximated from geometry until `with_sizer` adds a
    /// measuring sizer.
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
            sizes: Arc::new(SizeEstimator::new(None)),
        }
    }

    pub fn with_sizer(mut self, sizer: Arc<dyn ExtractSizer>) -> Self {
        self.sizes = Arc::new(SizeEstimator::new(Some(sizer)));
        self
    }
}
