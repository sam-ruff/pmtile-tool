import { defineStore } from 'pinia'
import { api } from '../api'
import type { Estimate, ExportArea, Limits } from '../api'

export type Step = 'area' | 'detail' | 'review'

export const STEPS: { id: Step; label: string }[] = [
  { id: 'area', label: 'Area' },
  { id: 'detail', label: 'Detail' },
  { id: 'review', label: 'Review' },
]

/// Streets and building outlines are where most people land; z15 roughly
/// doubles the size for house numbers and the finest detail.
export const DEFAULT_ZOOM = 14

export function zoomDescription(zoom: number): string {
  if (zoom <= 4) return 'Countries, seas and capitals'
  if (zoom <= 7) return 'Regions and large cities'
  if (zoom <= 10) return 'Towns and main roads'
  if (zoom <= 12) return 'Every road and village'
  if (zoom === 13) return 'Adds building outlines'
  if (zoom === 14) return 'Streets, buildings and paths'
  return 'Full detail, including house numbers'
}

export type EstimateVerdict = 'ok' | 'large' | 'too-large'

/// How an estimate sits against the server's per-export ceiling.
export function estimateVerdict(estimate: Estimate, limits: Limits): EstimateVerdict {
  if (estimate.bytes > limits.max_export_bytes || estimate.tiles > limits.max_estimated_tiles) {
    return 'too-large'
  }
  return estimate.bytes > limits.max_export_bytes * 0.5 ? 'large' : 'ok'
}

export const useDraftStore = defineStore('draft', {
  state: () => ({
    step: 'area' as Step,
    maxzoom: DEFAULT_ZOOM,
    name: '',
    estimate: null as Estimate | null,
    estimating: false,
    estimateError: null as string | null,
    estimateSeq: 0,
  }),

  actions: {
    goTo(step: Step) {
      this.step = step
    },

    async refreshEstimate(area: ExportArea | null) {
      const seq = ++this.estimateSeq
      if (!area) {
        this.estimate = null
        this.estimateError = null
        this.estimating = false
        return
      }
      this.estimating = true
      try {
        const estimate = await api().estimateExport(area, this.maxzoom)
        if (seq !== this.estimateSeq) return
        this.estimate = estimate
        this.estimateError = null
      } catch (e) {
        if (seq !== this.estimateSeq) return
        this.estimate = null
        this.estimateError = e instanceof Error ? e.message : 'could not estimate the size'
      } finally {
        if (seq === this.estimateSeq) this.estimating = false
      }
    },

    reset() {
      this.step = 'area'
      this.name = ''
      this.estimate = null
      this.estimateError = null
    },
  },
})
