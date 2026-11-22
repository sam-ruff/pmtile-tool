use geo::{MultiPolygon, Polygon};
use geojson::GeometryValue;

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("geometry must be a Polygon or MultiPolygon")]
    WrongType,
    #[error("geometry is empty")]
    Empty,
    #[error("geometry has {0} vertices, the maximum is {1}")]
    TooManyVertices(usize, usize),
    #[error(
        "coordinates out of range: longitude must be within [-180, 180] and latitude within [-90, 90]"
    )]
    OutOfRange,
    #[error("invalid geometry: {0}")]
    Invalid(String),
}

/// Convert a trusted GeoJSON geometry (a catalog region) to a geo
/// MultiPolygon, skipping the user-facing vertex cap. Returns None for
/// non-polygonal geometry or coordinates that cannot be converted.
pub fn to_multipolygon(geometry: &geojson::Geometry) -> Option<MultiPolygon> {
    match &geometry.value {
        GeometryValue::Polygon { .. } => {
            let polygon: Polygon = (&geometry.value).try_into().ok()?;
            Some(MultiPolygon(vec![polygon]))
        }
        GeometryValue::MultiPolygon { .. } => (&geometry.value).try_into().ok(),
        _ => None,
    }
}

/// Parse a user-supplied GeoJSON geometry and check its type, size and
/// coordinate range. Topology (self-intersections, overlaps) is not checked
/// here: `compose::compose_export_area` repairs it with a union.
pub fn parse_user_geometry(
    geometry: &geojson::Geometry,
    max_vertices: usize,
) -> Result<MultiPolygon, ValidationError> {
    let multi: MultiPolygon = match &geometry.value {
        GeometryValue::Polygon { .. } => {
            let polygon: Polygon = (&geometry.value)
                .try_into()
                .map_err(|e: geojson::Error| ValidationError::Invalid(e.to_string()))?;
            MultiPolygon(vec![polygon])
        }
        GeometryValue::MultiPolygon { .. } => (&geometry.value)
            .try_into()
            .map_err(|e: geojson::Error| ValidationError::Invalid(e.to_string()))?,
        _ => return Err(ValidationError::WrongType),
    };

    if multi.0.is_empty() || multi.0.iter().all(|p| p.exterior().0.is_empty()) {
        return Err(ValidationError::Empty);
    }

    let vertex_count: usize = multi
        .0
        .iter()
        .map(|p| p.exterior().0.len() + p.interiors().iter().map(|r| r.0.len()).sum::<usize>())
        .sum();
    if vertex_count > max_vertices {
        return Err(ValidationError::TooManyVertices(vertex_count, max_vertices));
    }

    let in_range = multi.0.iter().all(|p| {
        p.exterior()
            .0
            .iter()
            .chain(p.interiors().iter().flat_map(|r| r.0.iter()))
            .all(|c| c.x >= -180.0 && c.x <= 180.0 && c.y >= -90.0 && c.y <= 90.0)
    });
    if !in_range {
        return Err(ValidationError::OutOfRange);
    }

    Ok(multi)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn polygon_geometry(ring: Vec<[f64; 2]>) -> geojson::Geometry {
        geojson::Geometry::new_polygon(vec![ring])
    }

    #[test]
    fn accepts_simple_polygon() {
        let geometry = polygon_geometry(vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
            [0.0, 0.0],
        ]);
        let multi = parse_user_geometry(&geometry, 1000).expect("valid");
        assert_eq!(multi.0.len(), 1);
    }

    #[test]
    fn rejects_non_polygon() {
        let geometry = geojson::Geometry::new_point([0.0, 0.0]);
        assert!(matches!(
            parse_user_geometry(&geometry, 1000),
            Err(ValidationError::WrongType)
        ));
    }

    #[test]
    fn rejects_too_many_vertices() {
        let geometry = polygon_geometry(vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
            [0.0, 0.0],
        ]);
        assert!(matches!(
            parse_user_geometry(&geometry, 4),
            Err(ValidationError::TooManyVertices(5, 4))
        ));
    }

    #[test]
    fn rejects_out_of_range() {
        let geometry = polygon_geometry(vec![[-190.0, 0.0], [1.0, 0.0], [1.0, 1.0], [-190.0, 0.0]]);
        assert!(matches!(
            parse_user_geometry(&geometry, 1000),
            Err(ValidationError::OutOfRange)
        ));
    }

    #[test]
    fn leaves_self_intersection_for_repair() {
        // Bowtie: crosses itself in the middle. Repair happens in compose.
        let geometry = polygon_geometry(vec![
            [0.0, 0.0],
            [1.0, 1.0],
            [1.0, 0.0],
            [0.0, 1.0],
            [0.0, 0.0],
        ]);
        assert!(parse_user_geometry(&geometry, 1000).is_ok());
    }

    #[test]
    fn rejects_empty() {
        let geometry = geojson::Geometry::new_multi_polygon(Vec::<Vec<Vec<[f64; 2]>>>::new());
        assert!(matches!(
            parse_user_geometry(&geometry, 1000),
            Err(ValidationError::Empty)
        ));
    }
}
