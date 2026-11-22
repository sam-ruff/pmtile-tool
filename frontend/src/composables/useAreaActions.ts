import { mapController } from '../map/controller'
import { useRegionsStore } from '../stores/regions'
import { regionItemId, useSelectionStore } from '../stores/selection'
import { useServerStore } from '../stores/server'
import { useToastsStore } from '../stores/toasts'

/// Actions shared by the region browser, inspector and selection list.
export function useAreaActions() {
  const regions = useRegionsStore()
  const selection = useSelectionStore()
  const server = useServerStore()
  const toasts = useToastsStore()

  async function toggleRegion(regionId: string) {
    if (selection.hasRegion(regionId)) {
      selection.remove(regionItemId(regionId))
      return
    }
    if (selection.regions.length >= server.limits.max_export_regions) {
      toasts.push(
        'error',
        `An extract can combine at most ${server.limits.max_export_regions} regions.`,
      )
      return
    }
    selection.addRegion(regionId, regions.nameOf(regionId))
    const geometry = await regions.geometry(regionId)
    if (geometry) selection.setRegionGeometry(regionId, geometry)
  }

  async function inspect(regionId: string) {
    await regions.select(regionId)
    const geometry = await regions.geometry(regionId)
    if (regions.selectedId === regionId) mapController.inspectRegion(geometry)
  }

  function closeInspector() {
    void regions.select(null)
    mapController.inspectRegion(null)
  }

  return { toggleRegion, inspect, closeInspector }
}
