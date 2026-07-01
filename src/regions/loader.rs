use std::fs;
use std::path::{Path, PathBuf};

use super::{Region, RegionCatalog};

#[derive(Debug, thiserror::Error)]
pub enum RegionError {
    #[error("failed to read region index {0}: {1}")]
    Io(PathBuf, String),
    #[error("failed to parse region index {0}: {1}")]
    Parse(PathBuf, String),
    #[error("region index {0} is empty")]
    Empty(PathBuf),
}

impl RegionCatalog {
    /// Load the Geofabrik index-v1 GeoJSON (FeatureCollection of MultiPolygons
    /// with id/parent/name properties). Features without an id or geometry are
    /// skipped with a warning rather than failing the whole index.
    pub fn load(path: &Path) -> Result<Self, RegionError> {
        let raw = fs::read_to_string(path)
            .map_err(|e| RegionError::Io(path.to_path_buf(), e.to_string()))?;
        let collection: geojson::FeatureCollection = raw
            .parse::<geojson::GeoJson>()
            .map_err(|e| RegionError::Parse(path.to_path_buf(), e.to_string()))?
            .try_into()
            .map_err(|e: geojson::Error| RegionError::Parse(path.to_path_buf(), e.to_string()))?;

        let mut regions = Vec::with_capacity(collection.features.len());
        for feature in collection.features {
            let Some(properties) = &feature.properties else {
                continue;
            };
            let Some(id) = properties.get("id").and_then(|v| v.as_str()) else {
                tracing::warn!("skipping region feature without id");
                continue;
            };
            let Some(geometry) = feature.geometry.clone() else {
                tracing::warn!(region = id, "skipping region without geometry");
                continue;
            };
            let name = properties
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(id)
                .to_string();
            let parent = properties
                .get("parent")
                .and_then(|v| v.as_str())
                .map(String::from);
            regions.push(Region {
                id: id.to_string(),
                name,
                parent,
                geometry,
            });
        }

        if regions.is_empty() {
            return Err(RegionError::Empty(path.to_path_buf()));
        }
        Ok(Self::new(regions))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINI_INDEX: &str = r#"{
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"id": "europe", "name": "Europe"},
             "geometry": {"type": "MultiPolygon", "coordinates": [[[[0,0],[1,0],[1,1],[0,0]]]]}},
            {"type": "Feature", "properties": {"id": "united-kingdom", "parent": "europe", "name": "United Kingdom"},
             "geometry": {"type": "MultiPolygon", "coordinates": [[[[0,0],[0.5,0],[0.5,0.5],[0,0]]]]}},
            {"type": "Feature", "properties": {"name": "no id, skipped"},
             "geometry": {"type": "MultiPolygon", "coordinates": []}}
        ]
    }"#;

    #[test]
    fn loads_mini_index() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("index.json");
        fs::write(&path, MINI_INDEX).expect("write");

        let catalog = RegionCatalog::load(&path).expect("load");
        assert_eq!(catalog.len(), 2);
        let uk = catalog.get("united-kingdom").expect("uk");
        assert_eq!(uk.name, "United Kingdom");
        assert_eq!(uk.parent.as_deref(), Some("europe"));
        assert!(catalog.has_children("europe"));
    }

    #[test]
    fn loads_vendored_geofabrik_index() {
        let catalog =
            RegionCatalog::load(Path::new("assets/geofabrik-index-v1.json")).expect("load");
        assert!(
            catalog.len() > 500,
            "expected full index, got {}",
            catalog.len()
        );
        assert!(catalog.get("england").is_some());
        assert!(catalog.has_children("england"));
        assert_eq!(
            catalog
                .get("england")
                .and_then(|r| r.parent.clone())
                .as_deref(),
            Some("united-kingdom")
        );
    }

    #[test]
    fn missing_file_errors() {
        assert!(RegionCatalog::load(Path::new("nope.json")).is_err());
    }
}
