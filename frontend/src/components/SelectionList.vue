<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { CircleDashed, Lasso, MapPin, Pencil, Pentagon, Scan, SquareDashed, X } from '@lucide/vue'
import { mapController } from '../map/controller'
import { formatArea } from '../map/geometry'
import { TOOL_LABELS, useSelectionStore } from '../stores/selection'
import type { SelectionItem } from '../stores/selection'

const selection = useSelectionStore()

const ICONS = {
  rectangle: SquareDashed,
  polygon: Pentagon,
  freehand: Lasso,
  circle: CircleDashed,
}

const renaming = ref<string | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement[]>([])

function iconFor(item: SelectionItem) {
  return item.kind === 'drawn' ? ICONS[item.tool] : MapPin
}

function metaFor(item: SelectionItem): string {
  if (item.kind === 'region') return 'Region'
  return `${TOOL_LABELS[item.tool]}, ${formatArea(item.areaKm2)}`
}

function choose(item: SelectionItem) {
  selection.select(item.id)
  if (item.kind === 'drawn') {
    mapController.setTool('select')
    mapController.selectShape(item.id)
  }
}

async function startRename(item: SelectionItem) {
  renaming.value = item.id
  renameValue.value = item.label
  await nextTick()
  renameInput.value[0]?.select()
}

function commitRename() {
  if (renaming.value) selection.rename(renaming.value, renameValue.value)
  renaming.value = null
}
</script>

<template>
  <ul class="items" aria-label="Parts of your area">
    <li
      v-for="item in selection.items"
      :key="item.id"
      class="item"
      :class="{ selected: selection.selectedId === item.id, region: item.kind === 'region' }"
      :data-testid="`area-item-${item.kind}`"
    >
      <span class="swatch" aria-hidden="true">
        <component :is="iconFor(item)" :size="16" />
      </span>
      <div class="body">
        <input
          v-if="renaming === item.id"
          ref="renameInput"
          v-model="renameValue"
          class="input rename"
          maxlength="40"
          :aria-label="`Rename ${item.label}`"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.stop.prevent="renaming = null"
          @blur="commitRename"
        />
        <button v-else class="name" @click="choose(item)" @dblclick="startRename(item)">
          {{ item.label }}
        </button>
        <span class="hint">{{ metaFor(item) }}</span>
      </div>
      <div class="actions">
        <button
          v-if="item.kind === 'drawn'"
          class="icon-btn sm"
          :aria-label="`Rename ${item.label}`"
          title="Rename"
          @click="startRename(item)"
        >
          <Pencil :size="15" />
        </button>
        <button
          class="icon-btn sm"
          :aria-label="`Zoom to ${item.label}`"
          title="Zoom to"
          @click="mapController.zoomToSelection([item.id])"
        >
          <Scan :size="15" />
        </button>
        <button
          class="icon-btn sm"
          :aria-label="`Remove ${item.label}`"
          title="Remove"
          data-testid="area-item-remove"
          @click="selection.remove(item.id)"
        >
          <X :size="16" />
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 6px 7px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.item.selected {
  border-color: var(--draw);
  box-shadow: 0 0 0 2px var(--draw-soft);
}

.swatch {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  background: var(--draw-soft);
  color: var(--draw);
}

.item.region .swatch {
  background: var(--region-soft);
  color: var(--region);
}

.body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  text-align: left;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  border-radius: 4px;
}

.rename {
  min-height: 30px;
  padding: 3px 8px;
}

.actions {
  display: flex;
  gap: 0;
}
</style>
