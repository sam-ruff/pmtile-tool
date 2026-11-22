import { describe, expect, it } from 'vitest'
import { exportBody } from '../HttpPmtilesApi'
import type { GeoJSONGeometry } from '../types'

const SHAPE: GeoJSONGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
}

describe('exportBody', () => {
  it('sends both parts when present', () => {
    expect(exportBody({ geometry: SHAPE, regionIds: ['wales'] })).toEqual({
      geometry: SHAPE,
      region_ids: ['wales'],
    })
  })

  it('omits empty parts', () => {
    expect(exportBody({ geometry: SHAPE, regionIds: [] })).toEqual({ geometry: SHAPE })
    expect(exportBody({ regionIds: ['devon'] })).toEqual({ region_ids: ['devon'] })
  })
})
