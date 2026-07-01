import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockPmtilesApi } from '../MockPmtilesApi'
import { ApiRequestError } from '../types'
import type { GeoJSONGeometry } from '../types'

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

describe('MockPmtilesApi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks an export job through the full lifecycle', async () => {
    const api = new MockPmtilesApi()
    const job = await api.createExport(SMALL, 10)
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
    const low = await api.estimateExport(SMALL, 6)
    const high = await api.estimateExport(SMALL, 14)
    expect(high.tiles).toBeGreaterThan(low.tiles)
    expect(low.bytes).toBe(low.tiles * 85)
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
})
