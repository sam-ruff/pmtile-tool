use std::collections::BTreeSet;

use geo::MultiPolygon;
use geo::algorithm::bool_ops::{BooleanOps, FillRule};
use geo::algorithm::orient::{Direction, Orient};
use geo::algorithm::validation::Validation;

use super::validate::{ValidationError, parse_user_geometry, to_multipolygon};
use crate::config::Limits;
use crate::regions::RegionCatalog;

#[derive(Debug, thiserror::Error)]
pub enum ComposeError {
    #[error("an export needs a drawn geometry, at least one region, or both")]
    NothingSelected,
    #[error(transparent)]
    Geometry(#[from] ValidationError),
    #[error("an export can include at most {max} regions, {count} were given")]
    TooManyRegions { count: usize, max: usize },
    #[error("unknown region: {0}")]
    UnknownRegion(String),
    #[error("region {0} has no usable geometry")]
    UnusableRegion(String),
    #[error("the selected area is empty once overlaps are resolved")]
    EmptyResult,
    #[error("the selected area could not be turned into a valid polygon")]
    InvalidResult,
}

/// Build the single area an export is cut to: the drawn shapes (checked
/// against the user vertex cap) unioned with any catalogue regions. Overlaps
/// merge, disjoint parts stay separate polygons, and self-intersecting rings
/// such as a freehand loop that crosses itself are repaired by the union.
pub fn compose_export_area(
    catalog: &RegionCatalog,
    drawn: Option<&geojson::Geometry>,
    region_ids: &[String],
    limits: &Limits,
) -> Result<MultiPolygon, ComposeError> {
    let unique_ids: BTreeSet<&str> = region_ids.iter().map(String::as_str).collect();
    if drawn.is_none() && unique_ids.is_empty() {
        return Err(ComposeError::NothingSelected);
    }
    if unique_ids.len() > limits.max_export_regions {
        return Err(ComposeError::TooManyRegions {
            count: unique_ids.len(),
            max: limits.max_export_regions,
        });
    }

    let mut parts = Vec::new();
    if let Some(geometry) = drawn {
        parts.extend(parse_user_geometry(geometry, limits.max_polygon_vertices)?.0);
    }
    for id in unique_ids {
        let region = catalog
            .get(id)
            .ok_or_else(|| ComposeError::UnknownRegion(id.to_string()))?;
        let multi = to_multipolygon(&region.geometry)
            .ok_or_else(|| ComposeError::UnusableRegion(id.to_string()))?;
        parts.extend(multi.0);
    }

    // Consistent winding lets the non-zero rule fill overlaps and both lobes
    // of a self-crossing ring while keeping holes open.
    let oriented = MultiPolygon(parts).orient(Direction::Default);
    let union = oriented.union_with_fill_rule(&MultiPolygon(Vec::new()), FillRule::NonZero);
    if union.0.is_empty() {
        return Err(ComposeError::EmptyResult);
    }
    if !union.is_valid() {
        return Err(ComposeError::InvalidResult);
    }
    Ok(union)
}

#[cfg(test)]
mod tests {
    use geo::Area;

    use super::*;
    use crate::regions::Region;

    fn square(x: f64, y: f64, size: f64) -> Vec<[f64; 2]> {
        vec![
            [x, y],
            [x + size, y],
            [x + size, y + size],
            [x, y + size],
            [x, y],
        ]
    }

    fn multi(rings: Vec<Vec<[f64; 2]>>) -> geojson::Geometry {
        geojson::Geometry::new_multi_polygon(rings.into_iter().map(|r| vec![r]).collect::<Vec<_>>())
    }

    /// A detailed region ring with many vertices, a circle around (20, 20).
    fn detailed_ring(points: usize) -> Vec<[f64; 2]> {
        let mut ring: Vec<[f64; 2]> = (0..points)
            .map(|i| {
                let a = i as f64 / points as f64 * std::f64::consts::TAU;
                [20.0 + a.cos(), 20.0 + a.sin()]
            })
            .collect();
        ring.push(ring[0]);
        ring
    }

    fn catalog() -> RegionCatalog {
        let region = |id: &str, ring: Vec<[f64; 2]>| Region {
            id: id.into(),
            name: id.to_uppercase(),
            parent: None,
            geometry: geojson::Geometry::new_multi_polygon(vec![vec![ring]]),
        };
        RegionCatalog::new(vec![
            region("wales", square(10.0, 10.0, 2.0)),
            region("detailed", detailed_ring(5000)),
            region("overlapping", square(0.5, 0.5, 1.0)),
        ])
    }

    fn limits() -> Limits {
        Limits {
            max_polygon_vertices: 100,
            max_export_regions: 2,
            ..Limits::default()
        }
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn disjoint_shapes_stay_separate() {
        let drawn = multi(vec![square(0.0, 0.0, 1.0), square(5.0, 5.0, 1.0)]);
        let area = compose_export_area(&catalog(), Some(&drawn), &[], &limits()).expect("area");
        assert_eq!(area.0.len(), 2);
    }

    #[test]
    fn overlapping_shapes_merge() {
        let drawn = multi(vec![square(0.0, 0.0, 1.0), square(0.5, 0.5, 1.0)]);
        let area = compose_export_area(&catalog(), Some(&drawn), &[], &limits()).expect("area");
        assert_eq!(area.0.len(), 1);
        assert!((area.unsigned_area() - 1.75).abs() < 1e-9);
    }

    #[test]
    fn opposite_windings_still_merge() {
        let mut reversed = square(0.5, 0.5, 1.0);
        reversed.reverse();
        let drawn = multi(vec![square(0.0, 0.0, 1.0), reversed]);
        let area = compose_export_area(&catalog(), Some(&drawn), &[], &limits()).expect("area");
        assert!((area.unsigned_area() - 1.75).abs() < 1e-9);
    }

    #[test]
    fn self_intersecting_ring_is_repaired() {
        let bowtie = geojson::Geometry::new_polygon(vec![vec![
            [0.0, 0.0],
            [1.0, 1.0],
            [1.0, 0.0],
            [0.0, 1.0],
            [0.0, 0.0],
        ]]);
        let area = compose_export_area(&catalog(), Some(&bowtie), &[], &limits()).expect("area");
        assert!(area.is_valid());
        assert!((area.unsigned_area() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn regions_union_with_drawn_shapes() {
        let drawn = multi(vec![square(0.0, 0.0, 1.0)]);
        let area = compose_export_area(
            &catalog(),
            Some(&drawn),
            &ids(&["wales", "overlapping"]),
            &limits(),
        )
        .expect("area");
        // The drawn square and "overlapping" merge; Wales stays separate.
        assert_eq!(area.0.len(), 2);
        assert!((area.unsigned_area() - (1.75 + 4.0)).abs() < 1e-9);
    }

    #[test]
    fn regions_alone_are_enough() {
        let area =
            compose_export_area(&catalog(), None, &ids(&["wales"]), &limits()).expect("area");
        assert_eq!(area.0.len(), 1);
    }

    #[test]
    fn unknown_region_is_named() {
        let err = compose_export_area(&catalog(), None, &ids(&["atlantis"]), &limits())
            .expect_err("unknown");
        assert!(matches!(err, ComposeError::UnknownRegion(ref id) if id == "atlantis"));
        assert!(err.to_string().contains("atlantis"));
    }

    #[test]
    fn too_many_regions_rejected() {
        let err = compose_export_area(
            &catalog(),
            None,
            &ids(&["wales", "detailed", "overlapping"]),
            &limits(),
        )
        .expect_err("too many");
        assert!(matches!(
            err,
            ComposeError::TooManyRegions { count: 3, max: 2 }
        ));
    }

    #[test]
    fn duplicate_regions_counted_once() {
        let area = compose_export_area(
            &catalog(),
            None,
            &ids(&["wales", "wales", "wales"]),
            &limits(),
        )
        .expect("area");
        assert!((area.unsigned_area() - 4.0).abs() < 1e-9);
    }

    #[test]
    fn vertex_cap_applies_to_drawn_shapes_only() {
        let area =
            compose_export_area(&catalog(), None, &ids(&["detailed"]), &limits()).expect("area");
        assert_eq!(area.0.len(), 1);

        let drawn = geojson::Geometry::new_polygon(vec![detailed_ring(200)]);
        let err =
            compose_export_area(&catalog(), Some(&drawn), &[], &limits()).expect_err("over cap");
        assert!(matches!(
            err,
            ComposeError::Geometry(ValidationError::TooManyVertices(201, 100))
        ));
    }

    #[test]
    fn empty_request_rejected() {
        let err = compose_export_area(&catalog(), None, &[], &limits()).expect_err("empty");
        assert!(matches!(err, ComposeError::NothingSelected));
    }

    #[test]
    fn zero_area_shape_rejected() {
        let flat = geojson::Geometry::new_polygon(vec![vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [2.0, 0.0],
            [0.0, 0.0],
        ]]);
        let err = compose_export_area(&catalog(), Some(&flat), &[], &limits()).expect_err("flat");
        assert!(matches!(err, ComposeError::EmptyResult));
    }
}
