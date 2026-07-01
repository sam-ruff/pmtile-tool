use geo::MultiPolygon;
use serde::Serialize;

/// Web Mercator latitude cutoff; the planet basemap contains nothing beyond it.
const MERC_MAX_LAT: f64 = 85.051_128_78;

#[derive(Debug, Clone, Copy, Serialize, utoipa::ToSchema)]
pub struct Estimate {
    pub tiles: u64,
    pub bytes: u64,
}

/// Estimate how many tiles (and roughly how many bytes) an extract covers.
///
/// Classic rasterisation bound per zoom level: a polygon covering fraction `a`
/// of the projected world with boundary length `p` (world widths) touches at
/// most about `a*4^z + p*2^z + 1` tiles at zoom z; the estimate sums z0..=maxzoom.
pub fn estimate(multi: &MultiPolygon, maxzoom: u8, avg_tile_bytes: u64) -> Estimate {
    let (area, perimeter) = projected_area_and_perimeter(multi);
    let mut tiles = 0.0_f64;
    for z in 0..=i32::from(maxzoom) {
        let per_zoom = area * 4.0_f64.powi(z) + perimeter * 2.0_f64.powi(z) + 1.0;
        tiles += per_zoom;
    }
    let tiles = tiles.min(u64::MAX as f64) as u64;
    Estimate {
        tiles,
        bytes: tiles.saturating_mul(avg_tile_bytes),
    }
}

/// Project a lon/lat coordinate onto the Web Mercator unit square.
fn project(lon: f64, lat: f64) -> (f64, f64) {
    let x = (lon + 180.0) / 360.0;
    let lat = lat.clamp(-MERC_MAX_LAT, MERC_MAX_LAT).to_radians();
    let y = (1.0 - ((lat.tan() + 1.0 / lat.cos()).ln()) / std::f64::consts::PI) / 2.0;
    (x, y)
}

/// Shoelace area and boundary length of the projected geometry, both as
/// fractions of the unit square (area) / unit width (perimeter).
fn projected_area_and_perimeter(multi: &MultiPolygon) -> (f64, f64) {
    let mut area = 0.0;
    let mut perimeter = 0.0;
    for polygon in &multi.0 {
        area += ring_area(polygon.exterior().0.iter().map(|c| project(c.x, c.y)));
        for interior in polygon.interiors() {
            area -= ring_area(interior.0.iter().map(|c| project(c.x, c.y)));
        }
        for ring in std::iter::once(polygon.exterior()).chain(polygon.interiors().iter()) {
            perimeter += ring_length(ring.0.iter().map(|c| project(c.x, c.y)));
        }
    }
    (area.max(0.0), perimeter)
}

fn ring_area(points: impl Iterator<Item = (f64, f64)>) -> f64 {
    let points: Vec<(f64, f64)> = points.collect();
    if points.len() < 4 {
        return 0.0;
    }
    let mut sum = 0.0;
    for pair in points.windows(2) {
        sum += pair[0].0 * pair[1].1 - pair[1].0 * pair[0].1;
    }
    (sum / 2.0).abs()
}

fn ring_length(points: impl Iterator<Item = (f64, f64)>) -> f64 {
    let points: Vec<(f64, f64)> = points.collect();
    points
        .windows(2)
        .map(|pair| {
            let dx = pair[1].0 - pair[0].0;
            let dy = pair[1].1 - pair[0].1;
            (dx * dx + dy * dy).sqrt()
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::{Coord, LineString, Polygon};

    fn rect(min_lon: f64, min_lat: f64, max_lon: f64, max_lat: f64) -> MultiPolygon {
        let ring = LineString::from(vec![
            Coord {
                x: min_lon,
                y: min_lat,
            },
            Coord {
                x: max_lon,
                y: min_lat,
            },
            Coord {
                x: max_lon,
                y: max_lat,
            },
            Coord {
                x: min_lon,
                y: max_lat,
            },
            Coord {
                x: min_lon,
                y: min_lat,
            },
        ]);
        MultiPolygon(vec![Polygon::new(ring, vec![])])
    }

    #[test]
    fn whole_world_covers_full_pyramid() {
        let world = rect(-180.0, -MERC_MAX_LAT, 180.0, MERC_MAX_LAT);
        let estimate = estimate(&world, 4, 100);
        // Full pyramid z0..=4 is 1+4+16+64+256 = 341 tiles; the bound adds the
        // perimeter term so it must be >= the true count but same magnitude.
        assert!(estimate.tiles >= 341, "tiles = {}", estimate.tiles);
        assert!(estimate.tiles < 341 * 3, "tiles = {}", estimate.tiles);
        assert_eq!(estimate.bytes, estimate.tiles * 100);
    }

    #[test]
    fn small_polygon_is_cheap() {
        // Roughly London-sized box.
        let london = rect(-0.3, 51.4, 0.1, 51.6);
        let estimate = estimate(&london, 15, 100);
        // A tiny fraction of the world: sanity band, thousands not millions.
        assert!(estimate.tiles > 15, "tiles = {}", estimate.tiles);
        assert!(estimate.tiles < 100_000, "tiles = {}", estimate.tiles);
    }

    #[test]
    fn estimate_grows_with_zoom() {
        let box_ = rect(-10.0, 40.0, 10.0, 55.0);
        let low = estimate(&box_, 8, 100);
        let high = estimate(&box_, 12, 100);
        assert!(high.tiles > low.tiles);
    }
}
