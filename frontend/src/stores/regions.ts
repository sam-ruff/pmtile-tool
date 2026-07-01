import { defineStore } from 'pinia'
import { api } from '../api'
import type { GeoJSONGeometry, RegionDetail, RegionSummary } from '../api'

interface RegionsState {
  summaries: RegionSummary[]
  loaded: boolean
  loadError: string | null
  search: string
  expanded: Set<string>
  selectedId: string | null
  detail: RegionDetail | null
  detailError: string | null
  geometries: Map<string, GeoJSONGeometry>
  extractPending: boolean
}

export const useRegionsStore = defineStore('regions', {
  state: (): RegionsState => ({
    summaries: [],
    loaded: false,
    loadError: null,
    search: '',
    expanded: new Set(),
    selectedId: null,
    detail: null,
    detailError: null,
    geometries: new Map(),
    extractPending: false,
  }),

  getters: {
    roots(state): RegionSummary[] {
      return state.summaries.filter((r) => !r.parent)
    },
    childrenOf(state): (id: string) => RegionSummary[] {
      return (id) => state.summaries.filter((r) => r.parent === id)
    },
    /// Case-insensitive name/id search across the whole hierarchy.
    searchResults(state): RegionSummary[] {
      const query = state.search.trim().toLowerCase()
      if (!query) return []
      return state.summaries
        .filter((r) => r.name.toLowerCase().includes(query) || r.id.includes(query))
        .slice(0, 30)
    },
  },

  actions: {
    async load() {
      if (this.loaded) return
      try {
        this.summaries = await api().listRegions()
        this.loaded = true
        this.loadError = null
      } catch (e) {
        this.loadError = e instanceof Error ? e.message : 'failed to load regions'
      }
    },

    toggleExpanded(id: string) {
      if (this.expanded.has(id)) {
        this.expanded.delete(id)
      } else {
        this.expanded.add(id)
      }
      // Reassign so Vue picks up Set mutations.
      this.expanded = new Set(this.expanded)
    },

    async select(id: string | null) {
      this.selectedId = id
      this.detail = null
      this.detailError = null
      if (!id) return
      try {
        this.detail = await api().regionDetail(id)
      } catch (e) {
        this.detailError = e instanceof Error ? e.message : 'failed to load region'
      }
    },

    async refreshDetail() {
      if (!this.selectedId) return
      try {
        this.detail = await api().regionDetail(this.selectedId)
      } catch {
        // transient refresh failure, keep showing the previous state
      }
    },

    async geometry(id: string): Promise<GeoJSONGeometry | null> {
      const cached = this.geometries.get(id)
      if (cached) return cached
      try {
        const geometry = await api().regionGeometry(id)
        this.geometries.set(id, geometry)
        return geometry
      } catch {
        return null
      }
    },

    async requestExtract() {
      if (!this.selectedId || this.extractPending) return
      this.extractPending = true
      try {
        const job = await api().requestRegionExtract(this.selectedId)
        if (this.detail && this.detail.id === this.selectedId) {
          this.detail = { ...this.detail, extract: job }
        }
      } catch (e) {
        this.detailError = e instanceof Error ? e.message : 'failed to request extract'
      } finally {
        this.extractPending = false
      }
    },
  },
})
