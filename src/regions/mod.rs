mod loader;

use std::collections::HashMap;

pub use loader::RegionError;
use serde::Serialize;

/// One Geofabrik region: a named MultiPolygon in a parent/child hierarchy.
#[derive(Debug, Clone)]
pub struct Region {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
    pub geometry: geojson::Geometry,
}

/// Flat list entry returned by the regions endpoint (no geometry).
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct RegionSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub has_children: bool,
}

/// In-memory region hierarchy loaded from the vendored Geofabrik index.
pub struct RegionCatalog {
    regions: HashMap<String, Region>,
    children: HashMap<String, Vec<String>>,
}

impl RegionCatalog {
    pub fn new(regions: Vec<Region>) -> Self {
        let mut children: HashMap<String, Vec<String>> = HashMap::new();
        for region in &regions {
            if let Some(parent) = &region.parent {
                children
                    .entry(parent.clone())
                    .or_default()
                    .push(region.id.clone());
            }
        }
        for ids in children.values_mut() {
            ids.sort();
        }
        let regions = regions.into_iter().map(|r| (r.id.clone(), r)).collect();
        Self { regions, children }
    }

    pub fn get(&self, id: &str) -> Option<&Region> {
        self.regions.get(id)
    }

    pub fn has_children(&self, id: &str) -> bool {
        self.children.contains_key(id)
    }

    pub fn len(&self) -> usize {
        self.regions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.regions.is_empty()
    }

    /// All regions as summaries, sorted by id for a stable response.
    pub fn summaries(&self) -> Vec<RegionSummary> {
        let mut out: Vec<RegionSummary> = self
            .regions
            .values()
            .map(|r| RegionSummary {
                id: r.id.clone(),
                name: r.name.clone(),
                parent: r.parent.clone(),
                has_children: self.has_children(&r.id),
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(id: &str, parent: Option<&str>) -> Region {
        Region {
            id: id.into(),
            name: id.to_uppercase(),
            parent: parent.map(Into::into),
            geometry: geojson::Geometry::new_multi_polygon(Vec::<Vec<Vec<[f64; 2]>>>::new()),
        }
    }

    #[test]
    fn builds_hierarchy() {
        let catalog = RegionCatalog::new(vec![
            region("europe", None),
            region("united-kingdom", Some("europe")),
            region("england", Some("united-kingdom")),
        ]);
        assert_eq!(catalog.len(), 3);
        assert!(catalog.has_children("europe"));
        assert!(catalog.has_children("united-kingdom"));
        assert!(!catalog.has_children("england"));

        let summaries = catalog.summaries();
        assert_eq!(summaries.len(), 3);
        let england = summaries
            .iter()
            .find(|s| s.id == "england")
            .expect("england");
        assert_eq!(england.parent.as_deref(), Some("united-kingdom"));
        assert!(!england.has_children);
    }
}
