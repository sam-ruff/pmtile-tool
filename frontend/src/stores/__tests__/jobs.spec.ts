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

  it('untrack removes id, job and preview', () => {
    const store = useJobsStore()
    store.track(job('a'))
    store.previewId = 'a'
    store.untrack('a')
    expect(store.ordered).toEqual([])
    expect(store.previewId).toBeNull()
    expect(JSON.parse(localStorage.getItem('pmtile-tool:job-ids') ?? '[]')).toEqual([])
  })

  it('createExport tracks the new job', async () => {
    fakeApi.createExport.mockResolvedValue(job('new-job'))
    const store = useJobsStore()
    const created = await store.createExport(
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      10,
    )
    expect(created?.id).toBe('new-job')
    expect(store.ids).toContain('new-job')
    expect(store.createError).toBeNull()
  })

  it('createExport surfaces API errors', async () => {
    fakeApi.createExport.mockRejectedValue(new Error('export too large'))
    const store = useJobsStore()
    const created = await store.createExport(
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      15,
    )
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
})
