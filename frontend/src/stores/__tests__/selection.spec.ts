import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GeoJSONGeometry } from '../../api'
import { regionItemId, useSelectionStore } from '../selection'

function square(x: number): GeoJSONGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
        [x, 0],
      ],
    ],
  }
}

describe('selection store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('labels drawn shapes per tool and selects the newest', () => {
    const store = useSelectionStore()
    store.addDrawn('a', 'rectangle', square(0), 10)
    store.addDrawn('b', 'freehand', square(5), 20)
    store.addDrawn('c', 'rectangle', square(9), 30)
    expect(store.items.map((i) => i.label)).toEqual(['Rectangle 1', 'Freehand 1', 'Rectangle 2'])
    expect(store.selectedId).toBe('c')
  })

  it('merges disjoint drawn shapes into one MultiPolygon alongside regions', () => {
    const store = useSelectionStore()
    store.addDrawn('a', 'rectangle', square(0), 10)
    store.addDrawn('b', 'polygon', square(5), 10)
    store.addRegion('wales', 'Wales')
    const area = store.exportArea
    expect(area?.regionIds).toEqual(['wales'])
    expect(area?.geometry?.type).toBe('MultiPolygon')
    expect(area?.geometry?.coordinates).toHaveLength(2)
  })

  it('a single drawn shape stays a Polygon and regions alone have no geometry', () => {
    const store = useSelectionStore()
    store.addDrawn('a', 'circle', square(0), 10)
    expect(store.exportArea?.geometry?.type).toBe('Polygon')
    store.remove('a')
    store.addRegion('devon', 'Devon')
    expect(store.exportArea).toEqual({ geometry: undefined, regionIds: ['devon'] })
  })

  it('is empty with no export area', () => {
    expect(useSelectionStore().exportArea).toBeNull()
  })

  it('ignores a region added twice', () => {
    const store = useSelectionStore()
    store.addRegion('wales', 'Wales')
    store.addRegion('wales', 'Wales')
    expect(store.regions).toHaveLength(1)
    expect(store.hasRegion('wales')).toBe(true)
  })

  it('updates geometry and area after an edit', () => {
    const store = useSelectionStore()
    store.addDrawn('a', 'polygon', square(0), 10)
    store.updateDrawn('a', square(3), 42)
    expect(store.drawn[0]?.areaKm2).toBe(42)
    expect(store.drawn[0]?.geometry).toEqual(square(3))
  })

  it('counts drawn vertices only', () => {
    const store = useSelectionStore()
    store.addDrawn('a', 'polygon', square(0), 10)
    store.addRegion('wales', 'Wales', square(4))
    expect(store.drawnVertexCount).toBe(5)
  })

  it('renames with trimming and rejects blank names', () => {
    const store = useSelectionStore()
    store.addDrawn('a', 'polygon', square(0), 10)
    store.rename('a', '  Lake District  ')
    expect(store.items[0]?.label).toBe('Lake District')
    store.rename('a', '   ')
    expect(store.items[0]?.label).toBe('Lake District')
  })

  it('removing the selected item clears the selection', () => {
    const store = useSelectionStore()
    store.addDrawn('a', 'polygon', square(0), 10)
    store.remove('a')
    expect(store.selectedId).toBeNull()
    store.addRegion('wales', 'Wales')
    store.remove(regionItemId('wales'))
    expect(store.isEmpty).toBe(true)
  })
})
