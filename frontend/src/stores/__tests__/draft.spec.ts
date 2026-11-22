import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const fakeApi = { estimateExport: vi.fn() }

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, api: () => fakeApi }
})

import type { Estimate } from '../../api/types'
import { DEFAULT_LIMITS } from '../server'
import { estimateVerdict, useDraftStore, zoomDescription } from '../draft'

describe('draft store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('judges estimates against the size limit', () => {
    const limit = DEFAULT_LIMITS.max_export_bytes
    const sized = (tiles: number, bytes: number) => ({ tiles, bytes, measured: true })
    expect(estimateVerdict(sized(10, limit * 0.1), DEFAULT_LIMITS)).toBe('ok')
    expect(estimateVerdict(sized(10, limit * 0.6), DEFAULT_LIMITS)).toBe('large')
    expect(estimateVerdict(sized(10, limit + 1), DEFAULT_LIMITS)).toBe('too-large')
    expect(
      estimateVerdict(sized(DEFAULT_LIMITS.max_estimated_tiles + 1, 1), DEFAULT_LIMITS),
    ).toBe('too-large')
  })

  it('describes every zoom level', () => {
    for (let z = 1; z <= 15; z += 1) expect(zoomDescription(z)).not.toBe('')
    expect(zoomDescription(13)).toMatch(/building/i)
  })

  it('keeps only the latest estimate when requests overlap', async () => {
    let resolveFirst: (v: Estimate) => void = () => {}
    fakeApi.estimateExport
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ tiles: 2, bytes: 200, measured: true })
    const store = useDraftStore()
    const first = store.refreshEstimate({ regionIds: ['a'] })
    await store.refreshEstimate({ regionIds: ['b'] })
    resolveFirst({ tiles: 1, bytes: 100, measured: true })
    await first
    expect(store.estimate).toEqual({ tiles: 2, bytes: 200, measured: true })
    expect(store.estimating).toBe(false)
  })

  it('surfaces estimate errors and clears for an empty area', async () => {
    fakeApi.estimateExport.mockRejectedValueOnce(new Error('unknown region: x'))
    const store = useDraftStore()
    await store.refreshEstimate({ regionIds: ['x'] })
    expect(store.estimateError).toBe('unknown region: x')
    await store.refreshEstimate(null)
    expect(store.estimateError).toBeNull()
    expect(store.estimate).toBeNull()
  })
})
