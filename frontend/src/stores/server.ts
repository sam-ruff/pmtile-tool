import { defineStore } from 'pinia'
import { api } from '../api'
import type { Limits } from '../api'

/// Used until /status answers, matching the server defaults.
export const DEFAULT_LIMITS: Limits = {
  max_maxzoom: 15,
  max_export_bytes: 10 * 1024 ** 3,
  max_estimated_tiles: 150_000_000,
  max_polygon_vertices: 1000,
  max_export_regions: 20,
  export_ttl_hours: 48,
}

export const useServerStore = defineStore('server', {
  state: () => ({
    limits: DEFAULT_LIMITS as Limits,
    version: null as string | null,
  }),

  actions: {
    async load() {
      try {
        const status = await api().status()
        this.limits = status.limits ?? DEFAULT_LIMITS
        this.version = status.version
      } catch {
        // keep the defaults; the server enforces the real limits anyway
      }
    },
  },
})
