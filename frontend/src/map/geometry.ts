import type { GeoJSONGeometry } from '../api'

export type Bounds = [number, number, number, number]

/// Every polygon of a geometry as a list of rings.
export function polygonsOf(geometry: GeoJSONGeometry): number[][][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

export function countVertices(geometry: GeoJSONGeometry): number {
  return polygonsOf(geometry).reduce(
    (total, polygon) => total + polygon.reduce((sum, ring) => sum + ring.length, 0),
    0,
  )
}

/// Combine drawn shapes into one geometry. Overlaps are left for the server,
/// which unions them; a single shape stays a plain Polygon.
export function mergeGeometries(geometries: GeoJSONGeometry[]): GeoJSONGeometry | undefined {
  const polygons = geometries.flatMap(polygonsOf)
  if (polygons.length === 0) return undefined
  const [only] = polygons
  if (polygons.length === 1 && only) return { type: 'Polygon', coordinates: only }
  return { type: 'MultiPolygon', coordinates: polygons }
}

export function boundsOf(geometries: GeoJSONGeometry[]): Bounds | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const polygon of geometries.flatMap(polygonsOf)) {
    for (const ring of polygon) {
      for (const [lon = 0, lat = 0] of ring) {
        w = Math.min(w, lon)
        e = Math.max(e, lon)
        s = Math.min(s, lat)
        n = Math.max(n, lat)
      }
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null
}

/// Simplification tolerance in map units: freehand strokes keep detail down
/// to a couple of screen pixels at the zoom they were drawn at.
export function simplifyTolerance(resolution: number, pixels = 2): number {
  return Math.max(resolution * pixels, 0)
}

export function formatArea(km2: number): string {
  if (km2 >= 100) return `${Math.round(km2).toLocaleString('en-GB')} km²`
  if (km2 >= 1) return `${km2.toFixed(1)} km²`
  return `${Math.max(1, Math.round(km2 * 100))} ha`
}
