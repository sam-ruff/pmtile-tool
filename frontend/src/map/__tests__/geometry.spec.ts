import { describe, expect, it } from 'vitest'
import type { GeoJSONGeometry } from '../../api'
import {
  boundsOf,
  countVertices,
  formatArea,
  mergeGeometries,
  simplifyTolerance,
} from '../geometry'

const TRIANGLE: GeoJSONGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [1, 3],
      [0, 0],
    ],
  ],
}

const TWO: GeoJSONGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [10, 10],
        [11, 10],
        [11, 11],
        [10, 10],
      ],
    ],
    [
      [
        [-5, -5],
        [-4, -5],
        [-4, -4],
        [-5, -5],
      ],
    ],
  ],
}

describe('geometry helpers', () => {
  it('counts vertices across polygons', () => {
    expect(countVertices(TRIANGLE)).toBe(4)
    expect(countVertices(TWO)).toBe(8)
  })

  it('merges polygons and multipolygons into one MultiPolygon', () => {
    const merged = mergeGeometries([TRIANGLE, TWO])
    expect(merged?.type).toBe('MultiPolygon')
    expect(merged?.coordinates).toHaveLength(3)
  })

  it('keeps a lone polygon as a Polygon and returns nothing for no input', () => {
    expect(mergeGeometries([TRIANGLE])).toEqual(TRIANGLE)
    expect(mergeGeometries([])).toBeUndefined()
  })

  it('computes combined bounds', () => {
    expect(boundsOf([TRIANGLE, TWO])).toEqual([-5, -5, 11, 11])
    expect(boundsOf([])).toBeNull()
  })

  it('scales simplification with resolution', () => {
    expect(simplifyTolerance(10)).toBe(20)
    expect(simplifyTolerance(10, 3)).toBe(30)
  })

  it('formats areas at sensible precision', () => {
    expect(formatArea(2140.4)).toBe('2,140 km²')
    expect(formatArea(12.34)).toBe('12.3 km²')
    expect(formatArea(0.25)).toBe('25 ha')
  })
})
