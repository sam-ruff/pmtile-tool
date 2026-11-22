import { defineStore } from 'pinia'
import type { ExportArea, GeoJSONGeometry } from '../api'
import { countVertices, mergeGeometries } from '../map/geometry'

export type DrawTool = 'rectangle' | 'polygon' | 'freehand' | 'circle'

export interface DrawnItem {
  kind: 'drawn'
  id: string
  tool: DrawTool
  label: string
  geometry: GeoJSONGeometry
  areaKm2: number
}

export interface RegionItem {
  kind: 'region'
  id: string
  regionId: string
  label: string
  geometry: GeoJSONGeometry | null
}

export type SelectionItem = DrawnItem | RegionItem

export const TOOL_LABELS: Record<DrawTool, string> = {
  rectangle: 'Rectangle',
  polygon: 'Polygon',
  freehand: 'Freehand',
  circle: 'Circle',
}

interface SelectionState {
  items: SelectionItem[]
  selectedId: string | null
  counters: Record<DrawTool, number>
}

export function regionItemId(regionId: string): string {
  return `region:${regionId}`
}

/// Everything going into the next export: drawn shapes and catalogue regions.
export const useSelectionStore = defineStore('selection', {
  state: (): SelectionState => ({
    items: [],
    selectedId: null,
    counters: { rectangle: 0, polygon: 0, freehand: 0, circle: 0 },
  }),

  getters: {
    drawn(state): DrawnItem[] {
      return state.items.filter((i): i is DrawnItem => i.kind === 'drawn')
    },
    regions(state): RegionItem[] {
      return state.items.filter((i): i is RegionItem => i.kind === 'region')
    },
    isEmpty(state): boolean {
      return state.items.length === 0
    },
    drawnVertexCount(): number {
      return this.drawn.reduce((sum, item) => sum + countVertices(item.geometry), 0)
    },
    hasRegion(state): (regionId: string) => boolean {
      return (regionId) => state.items.some((i) => i.id === regionItemId(regionId))
    },
    exportArea(): ExportArea | null {
      if (this.items.length === 0) return null
      return {
        geometry: mergeGeometries(this.drawn.map((d) => d.geometry)),
        regionIds: this.regions.map((r) => r.regionId),
      }
    },
  },

  actions: {
    addDrawn(id: string, tool: DrawTool, geometry: GeoJSONGeometry, areaKm2: number) {
      this.counters[tool] += 1
      this.items.push({
        kind: 'drawn',
        id,
        tool,
        label: `${TOOL_LABELS[tool]} ${this.counters[tool]}`,
        geometry,
        areaKm2,
      })
      this.selectedId = id
    },

    updateDrawn(id: string, geometry: GeoJSONGeometry, areaKm2: number) {
      const item = this.items.find((i) => i.id === id)
      if (!item || item.kind !== 'drawn') return
      item.geometry = geometry
      item.areaKm2 = areaKm2
    },

    addRegion(regionId: string, label: string, geometry: GeoJSONGeometry | null = null) {
      const id = regionItemId(regionId)
      if (this.items.some((i) => i.id === id)) return
      this.items.push({ kind: 'region', id, regionId, label, geometry })
    },

    setRegionGeometry(regionId: string, geometry: GeoJSONGeometry) {
      const item = this.items.find((i) => i.id === regionItemId(regionId))
      if (!item || item.kind !== 'region') return
      item.geometry = geometry
    },

    rename(id: string, label: string) {
      const item = this.items.find((i) => i.id === id)
      const trimmed = label.trim()
      if (!item || !trimmed) return
      item.label = trimmed.slice(0, 40)
    },

    remove(id: string) {
      this.items = this.items.filter((i) => i.id !== id)
      if (this.selectedId === id) this.selectedId = null
    },

    select(id: string | null) {
      this.selectedId = id
    },

    clear() {
      this.items = []
      this.selectedId = null
    },
  },
})
