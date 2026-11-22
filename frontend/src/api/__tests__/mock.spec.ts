import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_BYTES_PER_TILE, MockPmtilesApi } from '../MockPmtilesApi'
import { ApiRequestError } from '../types'
import type { ExportArea, GeoJSONGeometry } from '../types'

const SMALL: GeoJSONGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
}

const AREA: ExportArea = { geometry: SMALL, regionIds: [] }

describe('MockPmtilesApi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks an export job through the full lifecycle', async () => {
    const api = new MockPmtilesApi()
    const job = await api.createExport(AREA, 10)
    expect(job.status).toBe('queued')

    await vi.advanceTimersByTimeAsync(1500)
    expect((await api.getExport(job.id)).status).toBe('running')

    await vi.advanceTimersByTimeAsync(3000)
    const done = await api.getExport(job.id)
    expect(done.status).toBe('done')
    expect(done.download_url).toContain(job.id)
    expect(done.file_size).toBeGreaterThan(0)
  })

  it('estimates grow with zoom', async () => {
    const api = new MockPmtilesApi()
    const low = await api.estimateExport(AREA, 6)
    const high = await api.estimateExport(AREA, 14)
    expect(high.tiles).toBeGreaterThan(low.tiles)
    expect(low.bytes).toBe(low.tiles * MOCK_BYTES_PER_TILE)
    expect(low.measured).toBe(true)
  })

  it('region extract is idempotent while pending', async () => {
    const api = new MockPmtilesApi()
    const first = await api.requestRegionExtract('cornwall')
    const second = await api.requestRegionExtract('cornwall')
    expect(second).toEqual(first)
  })

  it('unknown region rejects with 404', async () => {
    const api = new MockPmtilesApi()
    await expect(api.regionDetail('atlantis')).rejects.toBeInstanceOf(ApiRequestError)
  })

  it('combines drawn shapes and regions into one stored geometry', async () => {
    const api = new MockPmtilesApi()
    const job = await api.createExport({ geometry: SMALL, regionIds: ['wales', 'wales'] }, 8)
    const geometry = await api.exportGeometry(job.id)
    expect(geometry.type).toBe('MultiPolygon')
    expect(geometry.coordinates).toHaveLength(2)
  })

  it('a regions-only area costs more than nothing', async () => {
    const api = new MockPmtilesApi()
    const estimate = await api.estimateExport({ regionIds: ['cornwall'] }, 10)
    expect(estimate.tiles).toBeGreaterThan(11)
  })

  it('rejects an empty area and unknown regions with 400', async () => {
    const api = new MockPmtilesApi()
    await expect(api.estimateExport({ regionIds: [] }, 10)).rejects.toMatchObject({ status: 400 })
    await expect(api.estimateExport({ regionIds: ['atlantis'] }, 10)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('status reports the export limits', async () => {
    const api = new MockPmtilesApi()
    const status = await api.status()
    expect(status.limits?.max_polygon_vertices).toBe(1000)
  })
})
