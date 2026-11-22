<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Eye, X } from '@lucide/vue'
import { mapController } from './map/controller'
import { useJobsStore } from './stores/jobs'
import type { DownloadEntry } from './stores/jobs'
import { useRegionsStore } from './stores/regions'
import { useSelectionStore } from './stores/selection'
import { useServerStore } from './stores/server'
import { useStylesStore } from './stores/styles'
import { useToastsStore } from './stores/toasts'
import DownloadsDrawer from './components/DownloadsDrawer.vue'
import MapToolbar from './components/MapToolbar.vue'
import ToastHost from './components/ToastHost.vue'
import WizardPanel from './components/WizardPanel.vue'
import type { SheetSnap } from './components/WizardPanel.vue'
import ZoomControls from './components/ZoomControls.vue'

const mapEl = ref<HTMLElement | null>(null)
const downloadsOpen = ref(false)
const snap = ref<SheetSnap>('half')
const compact = ref(false)

const jobs = useJobsStore()
const regions = useRegionsStore()
const selection = useSelectionStore()
const server = useServerStore()
const styles = useStylesStore()
const toasts = useToastsStore()

const previewing = computed(() => mapController.previewUrl.value !== null)
const previewName = computed(() => {
  const url = mapController.previewUrl.value
  if (!url) return ''
  return jobs.downloads.find((d) => d.job.download_url && url.endsWith(d.job.download_url))?.title ?? 'extract'
})

// The controller stays Pinia-free; the stores drive it from here.
watch(
  () => styles.selected,
  (style) => mapController.setMapStyle(style),
  { immediate: true },
)

mapController.bind({
  shapeAdded: (id, tool, geometry, areaKm2) => selection.addDrawn(id, tool, geometry, areaKm2),
  shapeChanged: (id, geometry, areaKm2) => selection.updateDrawn(id, geometry, areaKm2),
  shapeSelected: (id) => selection.select(id),
  removeRequested: (id) => selection.remove(id),
})

watch(
  () => selection.drawn.map((d) => d.id),
  (ids) => mapController.syncShapes(ids),
)

watch(
  () =>
    selection.regions
      .filter((r) => r.geometry !== null)
      .map((r) => ({ id: r.id, geometry: r.geometry! })),
  (regionShapes) => mapController.setRegionShapes(regionShapes),
)

watch(
  () => selection.selectedId,
  (id) => {
    if (id === mapController.selectedShapeId.value) return
    mapController.selectShape(id && !id.startsWith('region:') ? id : null)
  },
)

// Drawing on a phone needs the map, so tuck the sheet away while a tool is on.
watch(
  () => mapController.tool.value,
  (tool) => {
    if (compact.value && tool !== 'select') snap.value = 'peek'
  },
)

function openDownloads() {
  downloadsOpen.value = true
}

function onStatusChange(entry: DownloadEntry) {
  if (entry.job.status === 'done') {
    toasts.push('success', `${entry.title} is ready to download`, 'Open', openDownloads)
  } else if (entry.job.status === 'failed') {
    toasts.push('error', `${entry.title} failed: ${entry.job.error ?? 'unknown error'}`, 'Details', openDownloads)
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  if (downloadsOpen.value || document.querySelector('[data-testid="style-editor"]')) return
  if (isTyping(event.target)) return
  if (event.key === 'Escape' && previewing.value) {
    mapController.setPreview(null)
    event.preventDefault()
    return
  }
  if (mapController.handleKey(event.key)) event.preventDefault()
}

let mq: MediaQueryList | null = null
function updateCompact() {
  compact.value = mq?.matches ?? false
}

onMounted(() => {
  if (mapEl.value) mapController.init(mapEl.value)
  mq = window.matchMedia('(max-width: 720px)')
  updateCompact()
  mq.addEventListener('change', updateCompact)
  document.addEventListener('keydown', onKeydown)
  jobs.setStatusListener(onStatusChange)
  void regions.load()
  void jobs.load()
  void server.load()
})

onBeforeUnmount(() => {
  mapController.destroy()
  mq?.removeEventListener('change', updateCompact)
  document.removeEventListener('keydown', onKeydown)
  jobs.setStatusListener(null)
})
</script>

<template>
  <div class="app" :class="{ compact }">
    <div ref="mapEl" class="map" :class="`tool-${mapController.tool.value}`" />

    <MapToolbar
      :compact="compact"
      :previewing="previewing"
      :active-downloads="jobs.activeCount"
      @open-downloads="openDownloads"
    >
      <div v-if="previewing" class="preview-banner surface" role="status" data-testid="preview-banner">
        <Eye :size="18" class="preview-icon" />
        <span>Previewing <strong>{{ previewName }}</strong>. Only its tiles are shown.</span>
        <button class="btn btn-secondary" @click="mapController.setPreview(null)">
          <X :size="16" /> Exit preview
        </button>
      </div>
    </MapToolbar>

    <ZoomControls />

    <WizardPanel
      v-model:snap="snap"
      :compact="compact"
      :active-downloads="jobs.activeCount"
      @open-downloads="openDownloads"
    />

    <ToastHost />

    <DownloadsDrawer v-if="downloadsOpen" @close="downloadsOpen = false" />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.map {
  position: absolute;
  inset: 0;
  background: var(--bg);
}

.map:not(.tool-select) {
  cursor: crosshair;
}

.preview-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  padding: 8px 8px 8px 14px;
  font-size: var(--text-sm);
  pointer-events: auto;
  border: 2px solid var(--preview);
}

.preview-icon {
  color: var(--preview);
  flex: none;
}

.compact .preview-banner {
  width: 100%;
  font-size: var(--text-xs);
}
</style>
