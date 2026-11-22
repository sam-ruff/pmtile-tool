import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { JobView } from '../../api'

const fakeApi = {
  getExport: vi.fn(),
  deleteExport: vi.fn(),
  createExport: vi.fn(),
}

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, api: () => fakeApi }
})

import { useJobsStore } from '../jobs'
import type { GeoJSONGeometry } from '../../api'

const SQUARE: GeoJSONGeometry = {
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

function job(id: string, status: JobView['status'] = 'queued'): JobView {
  return {
    id,
    kind: 'custom',
    status,
    maxzoom: 10,
    estimated_tiles: 100,
    created_at: new Date().toISOString(),
  }
}

describe('jobs store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('tracks jobs newest-first and persists ids', () => {
    const store = useJobsStore()
    store.track(job('a'))
    store.track(job('b'))
    expect(store.ordered.map((j) => j.id)).toEqual(['b', 'a'])
    expect(JSON.parse(localStorage.getItem('pmtile-tool:job-ids') ?? '[]')).toEqual(['b', 'a'])
  })

  it('untrack removes id and job', () => {
    const store = useJobsStore()
    store.track(job('a'))
    store.untrack('a')
    expect(store.ordered).toEqual([])
    expect(JSON.parse(localStorage.getItem('pmtile-tool:job-ids') ?? '[]')).toEqual([])
  })

  it('createExport tracks the new job', async () => {
    fakeApi.createExport.mockResolvedValue(job('new-job'))
    const store = useJobsStore()
    const created = await store.createExport({ geometry: SQUARE, regionIds: ['wales'] }, 10)
    expect(fakeApi.createExport).toHaveBeenCalledWith(
      { geometry: SQUARE, regionIds: ['wales'] },
      10,
      undefined,
    )
    expect(created?.id).toBe('new-job')
    expect(store.ids).toContain('new-job')
    expect(store.createError).toBeNull()
  })

  it('createExport surfaces API errors', async () => {
    fakeApi.createExport.mockRejectedValue(new Error('export too large'))
    const store = useJobsStore()
    const created = await store.createExport({ geometry: SQUARE, regionIds: [] }, 15)
    expect(created).toBeNull()
    expect(store.createError).toBe('export too large')
  })

  it('load drops jobs the backend no longer knows', async () => {
    localStorage.setItem('pmtile-tool:job-ids', JSON.stringify(['gone']))
    const { ApiRequestError } = await import('../../api')
    fakeApi.getExport.mockRejectedValue(new ApiRequestError(404, 'unknown'))
    const store = useJobsStore()
    await store.load()
    expect(store.ids).toEqual([])
  })

  it('region downloads are listed alongside custom ones and persisted', () => {
    const store = useJobsStore()
    store.track({ ...job('custom-1', 'done'), created_at: '2026-01-01T00:00:00Z' })
    store.trackRegion('wales', 'Wales', {
      ...job('wales', 'running'),
      kind: 'region',
      region_id: 'wales',
      created_at: '2026-01-02T00:00:00Z',
    })
    expect(store.downloads.map((d) => [d.kind, d.title])).toEqual([
      ['region', 'Wales'],
      ['custom', 'custom-1'],
    ])
    expect(store.activeCount).toBe(1)
    expect(JSON.parse(localStorage.getItem('pmtile-tool:region-ids') ?? '[]')).toEqual(['wales'])
    store.untrackRegion('wales')
    expect(store.downloads).toHaveLength(1)
  })

  it('notifies the status listener when a polled job changes status', async () => {
    const store = useJobsStore()
    const listener = vi.fn()
    store.setStatusListener(listener)
    store.track(job('a', 'running'))
    fakeApi.getExport.mockResolvedValue(job('a', 'done'))
    await store.refreshActive()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0].job.status).toBe('done')
    expect(listener.mock.calls[0]?.[1]).toBe('running')
    store.setStatusListener(null)
    window.clearTimeout(store.pollHandle ?? undefined)
  })
})
