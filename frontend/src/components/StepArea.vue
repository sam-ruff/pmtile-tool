<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Lasso, MapPinned, SquareDashed } from '@lucide/vue'
import { mapController } from '../map/controller'
import { useSelectionStore } from '../stores/selection'
import { useServerStore } from '../stores/server'
import RegionBrowser from './RegionBrowser.vue'
import SelectionList from './SelectionList.vue'

type Tab = 'area' | 'browse'

const selection = useSelectionStore()
const server = useServerStore()

const tab = ref<Tab>(selection.isEmpty ? 'browse' : 'area')
const tabs = computed<{ id: Tab; label: string }[]>(() => [
  { id: 'area', label: `Your area (${selection.items.length})` },
  { id: 'browse', label: 'Browse regions' },
])

// A freshly drawn shape is the thing people want to see next.
watch(
  () => selection.drawn.length,
  (now, before) => {
    if (now > before) tab.value = 'area'
  },
)

const vertexUse = computed(() => selection.drawnVertexCount / server.limits.max_polygon_vertices)

function onTabKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  tab.value = tab.value === 'area' ? 'browse' : 'area'
  void Promise.resolve().then(() =>
    document.querySelector<HTMLElement>(`[data-tab="${tab.value}"]`)?.focus(),
  )
}
</script>

<template>
  <div class="step-area">
    <div class="intro">
      <h2>Choose what to include</h2>
      <p class="muted">
        Draw shapes with the tools on the map, or add ready-made regions. Separate areas all go
        into one file.
      </p>
    </div>

    <div class="tabs" role="tablist" aria-label="Area" @keydown="onTabKey">
      <button
        v-for="t in tabs"
        :key="t.id"
        role="tab"
        class="tab"
        :data-tab="t.id"
        :aria-selected="tab === t.id"
        :tabindex="tab === t.id ? 0 : -1"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="tab === 'area'" role="tabpanel" class="panel">
      <div v-if="selection.isEmpty" class="empty">
        <MapPinned :size="28" class="empty-icon" />
        <p class="label">Nothing in your area yet</p>
        <p class="muted">Draw a shape on the map or pick a region to start.</p>
        <div class="empty-actions">
          <button class="btn btn-secondary" @click="mapController.setTool('rectangle')">
            <SquareDashed :size="16" /> Draw a rectangle
          </button>
          <button class="btn btn-secondary" @click="mapController.setTool('freehand')">
            <Lasso :size="16" /> Draw freehand
          </button>
          <button class="btn btn-ghost" @click="tab = 'browse'">Browse regions</button>
        </div>
      </div>
      <template v-else>
        <SelectionList />
        <p v-if="selection.drawn.length > 0" class="hint" :class="{ warn: vertexUse > 0.8 }">
          {{ selection.drawnVertexCount }} of {{ server.limits.max_polygon_vertices }} drawn
          points used.
          <template v-if="vertexUse > 1">Remove or simplify a shape to continue.</template>
        </p>
        <button class="btn btn-ghost clear" @click="selection.clear()">Clear everything</button>
      </template>
    </div>

    <div v-else role="tabpanel" class="panel">
      <RegionBrowser />
    </div>
  </div>
</template>

<style scoped>
.step-area {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

h2 {
  font-size: var(--text-lg);
}

.tabs {
  display: flex;
  gap: 16px;
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: 8px 2px;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.tab[aria-selected='true'] {
  color: var(--text);
  border-bottom-color: var(--primary);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 24px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
}

.empty-icon {
  color: var(--text-faint);
  margin-bottom: 4px;
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.warn {
  color: var(--warning);
}

.clear {
  align-self: flex-start;
  min-height: 32px;
  padding: 4px 8px;
}
</style>
