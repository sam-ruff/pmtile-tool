<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { mapController } from './map/controller'
import { useJobsStore } from './stores/jobs'
import { useRegionsStore } from './stores/regions'
import RegionsPanel from './components/RegionsPanel.vue'
import RegionDetailCard from './components/RegionDetailCard.vue'
import ExportPanel from './components/ExportPanel.vue'
import JobsPanel from './components/JobsPanel.vue'

type Tab = 'regions' | 'export' | 'jobs'

const mapEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const tab = ref<Tab>('regions')
const panelOpen = ref(true)

const jobs = useJobsStore()
const regions = useRegionsStore()

const jobsBadge = computed(() => jobs.activeCount)

// Floating map cards sit bottom-centre. On mobile the panel is a bottom sheet,
// so lift them clear of its measured height; on desktop it is a side panel and
// a small fixed offset is enough.
const isMobile = ref(false)
const sheetHeight = ref(0)
const cardBottom = computed(() => (isMobile.value ? `${sheetHeight.value + 12}px` : '24px'))

let mq: MediaQueryList | null = null
let ro: ResizeObserver | null = null
function updateMobile() {
  isMobile.value = mq?.matches ?? false
}

onMounted(() => {
  if (mapEl.value) {
    mapController.init(mapEl.value)
  }
  mq = window.matchMedia('(max-width: 720px)')
  updateMobile()
  mq.addEventListener('change', updateMobile)
  if (panelEl.value) {
    ro = new ResizeObserver(() => {
      sheetHeight.value = panelEl.value?.offsetHeight ?? 0
    })
    ro.observe(panelEl.value)
  }
  void regions.load()
  void jobs.load()
})

onBeforeUnmount(() => {
  mapController.destroy()
  mq?.removeEventListener('change', updateMobile)
  ro?.disconnect()
})
</script>

<template>
  <div class="app" :style="{ '--card-bottom': cardBottom }">
    <div ref="mapEl" class="map" />

    <RegionDetailCard />

    <aside ref="panelEl" class="panel" :class="{ closed: !panelOpen }">
      <header class="panel-header">
        <h1>PMTiles Extract Tool</h1>
        <button
          class="btn-ghost panel-toggle"
          :aria-label="panelOpen ? 'Collapse panel' : 'Expand panel'"
          @click="panelOpen = !panelOpen"
        >
          {{ panelOpen ? '×' : '≡' }}
        </button>
      </header>

      <template v-if="panelOpen">
        <nav class="tabs">
          <button :class="{ active: tab === 'regions' }" @click="tab = 'regions'">Regions</button>
          <button :class="{ active: tab === 'export' }" @click="tab = 'export'">
            Custom export
          </button>
          <button :class="{ active: tab === 'jobs' }" @click="tab = 'jobs'">
            Jobs<span v-if="jobsBadge > 0" class="tab-badge">{{ jobsBadge }}</span>
          </button>
        </nav>

        <div class="panel-body">
          <RegionsPanel v-if="tab === 'regions'" />
          <ExportPanel v-else-if="tab === 'export'" />
          <JobsPanel v-else />
        </div>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
}

.map {
  position: absolute;
  inset: 0;
  background: #e8f0f0;
}

.panel {
  position: absolute;
  top: 16px;
  left: 16px;
  bottom: 16px;
  width: 360px;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
  z-index: 20;
}

.panel.closed {
  bottom: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.panel-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.panel-toggle {
  font-size: 16px;
  line-height: 1;
  padding: 4px 10px;
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.tabs button {
  flex: 1;
  padding: 8px 4px;
  background: transparent;
  color: var(--text-muted);
  font-weight: 500;
  border-radius: var(--radius);
}

.tabs button:hover {
  background: var(--surface-alt);
}

.tabs button.active {
  background: var(--primary-light);
  color: var(--primary-dark);
}

.tab-badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

@media (max-width: 720px) {
  .panel {
    top: auto;
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    max-height: 55dvh;
  }

  .panel.closed {
    max-height: none;
  }
}
</style>
