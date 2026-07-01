import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RegionSummary } from '../../api'

const SUMMARIES: RegionSummary[] = [
  { id: 'europe', name: 'Europe', has_children: true },
  { id: 'united-kingdom', name: 'United Kingdom', parent: 'europe', has_children: true },
  { id: 'england', name: 'England', parent: 'united-kingdom', has_children: true },
  { id: 'devon', name: 'Devon', parent: 'england', has_children: false },
]

const fakeApi = {
  listRegions: vi.fn(async () => SUMMARIES),
  regionDetail: vi.fn(),
  regionGeometry: vi.fn(),
}

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, api: () => fakeApi }
})

import { useRegionsStore } from '../regions'

describe('regions store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('builds roots and children from the flat list', async () => {
    const store = useRegionsStore()
    await store.load()
    expect(store.roots.map((r) => r.id)).toEqual(['europe'])
    expect(store.childrenOf('united-kingdom').map((r) => r.id)).toEqual(['england'])
  })

  it('search matches names case-insensitively', async () => {
    const store = useRegionsStore()
    await store.load()
    store.search = 'devon'
    expect(store.searchResults.map((r) => r.id)).toEqual(['devon'])
    store.search = 'KINGDOM'
    expect(store.searchResults.map((r) => r.id)).toEqual(['united-kingdom'])
  })

  it('caches geometries per region', async () => {
    fakeApi.regionGeometry.mockResolvedValue({ type: 'MultiPolygon', coordinates: [] })
    const store = useRegionsStore()
    await store.geometry('devon')
    await store.geometry('devon')
    expect(fakeApi.regionGeometry).toHaveBeenCalledTimes(1)
  })

  it('select surfaces detail errors', async () => {
    fakeApi.regionDetail.mockRejectedValue(new Error('unknown region'))
    const store = useRegionsStore()
    await store.select('atlantis')
    expect(store.detailError).toBe('unknown region')
    expect(store.detail).toBeNull()
  })
})
