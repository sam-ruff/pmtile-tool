<script setup lang="ts">
import { computed } from 'vue'
import {
  Check,
  CircleDashed,
  Download,
  Lasso,
  MousePointer2,
  Pentagon,
  Scan,
  SquareDashed,
  Trash2,
  Undo2,
} from '@lucide/vue'
import { mapController } from '../map/controller'
import type { Tool } from '../map/controller'
import { useSelectionStore } from '../stores/selection'
import StylePicker from './StylePicker.vue'

defineProps<{ compact: boolean; activeDownloads: number; previewing: boolean }>()
const emit = defineEmits<{ openDownloads: [] }>()

const selection = useSelectionStore()

const tools: { id: Tool; label: string; key: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select and edit', key: 'V', icon: MousePointer2 },
  { id: 'rectangle', label: 'Rectangle', key: 'R', icon: SquareDashed },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: Pentagon },
  { id: 'freehand', label: 'Freehand', key: 'F', icon: Lasso },
  { id: 'circle', label: 'Circle', key: 'C', icon: CircleDashed },
]

const tool = computed(() => mapController.tool.value)
const sketching = computed(() => mapController.sketching.value)
const selectedShape = computed(() => mapController.selectedShapeId.value)

const hint = computed(() => {
  switch (tool.value) {
    case 'rectangle':
      return 'Click one corner, then the opposite corner.'
    case 'circle':
      return 'Click the centre, then click again to set the radius.'
    case 'freehand':
      return 'Press and drag around the area, then let go.'
    case 'polygon':
      return sketching.value
        ? 'Click the first point or press Enter to finish. Backspace removes the last point.'
        : 'Click to place each corner.'
    default:
      return null
  }
})

function removeSelected() {
  if (selectedShape.value) selection.remove(selectedShape.value)
}
</script>

<template>
  <div class="toolbar-wrap" :class="{ compact }">
    <div class="toolbar surface" role="toolbar" aria-label="Drawing tools">
      <template v-if="!previewing">
      <button
        v-for="t in tools"
        :key="t.id"
        class="tool"
        :class="{ on: tool === t.id }"
        :aria-pressed="tool === t.id"
        :aria-label="`${t.label} (${t.key})`"
        :data-tip="`${t.label}  ${t.key}`"
        :data-testid="`tool-${t.id}`"
        @click="mapController.setTool(tool === t.id && t.id !== 'select' ? 'select' : t.id)"
      >
        <component :is="t.icon" :size="18" :stroke-width="1.9" />
      </button>
      <span class="divider" />
      <template v-if="sketching && tool === 'polygon'">
        <button
          class="tool"
          aria-label="Remove last point"
          data-tip="Remove last point  Backspace"
          @click="mapController.undoLastPoint()"
        >
          <Undo2 :size="18" :stroke-width="1.9" />
        </button>
        <button
          class="tool tool-accept"
          aria-label="Finish shape"
          data-tip="Finish shape  Enter"
          @click="mapController.finishSketch()"
        >
          <Check :size="18" :stroke-width="2.2" />
        </button>
      </template>
      <template v-else>
        <button
          class="tool"
          :disabled="!selectedShape"
          aria-label="Delete selected shape"
          data-tip="Delete selected  Del"
          data-testid="tool-delete"
          @click="removeSelected"
        >
          <Trash2 :size="18" :stroke-width="1.9" />
        </button>
        <button
          class="tool"
          :disabled="selection.isEmpty"
          aria-label="Zoom to your area"
          data-tip="Zoom to your area"
          @click="mapController.zoomToSelection()"
        >
          <Scan :size="18" :stroke-width="1.9" />
        </button>
      </template>
      <span class="divider" />
      </template>
      <StylePicker :compact="compact" />
      <template v-if="compact">
        <button
          class="tool downloads"
          :aria-label="`Downloads${activeDownloads ? `, ${activeDownloads} in progress` : ''}`"
          data-testid="open-downloads"
          @click="emit('openDownloads')"
        >
          <Download :size="18" :stroke-width="1.9" />
          <span v-if="activeDownloads" class="badge num">{{ activeDownloads }}</span>
        </button>
      </template>
    </div>
    <slot />
    <p v-if="hint && !previewing" class="draw-hint surface" role="status">
      {{ hint }} <span class="esc">Esc to stop</span>
    </p>
  </div>
</template>

<style scoped>
.toolbar-wrap {
  position: absolute;
  top: 16px;
  left: calc(var(--panel-width) + 32px);
  right: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 25;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  pointer-events: auto;
}

.tool {
  position: relative;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius);
  color: var(--text);
}

.tool:hover:not(:disabled):not(.on) {
  background: var(--surface-2);
}

.tool.on {
  background: var(--primary);
  color: var(--on-primary);
}

.tool-accept {
  color: var(--primary-text);
}

.tool[data-tip]:hover::after,
.tool[data-tip]:focus-visible::after {
  content: attr(data-tip);
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--text);
  color: var(--surface);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: pre;
  pointer-events: none;
  z-index: 5;
}

.divider {
  width: 1px;
  height: 22px;
  margin: 0 4px;
  background: var(--border);
}

.badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--draw);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: grid;
  place-items: center;
}

.draw-hint {
  pointer-events: auto;
  padding: 7px 12px;
  font-size: var(--text-sm);
  border-radius: var(--radius);
  max-width: 100%;
  text-align: center;
}

.esc {
  color: var(--text-muted);
  margin-left: 6px;
}

.compact {
  top: 8px;
  left: 8px;
  right: 8px;
}

.compact .toolbar {
  width: 100%;
  justify-content: space-between;
  gap: 0;
  padding: 4px;
}

.compact .tool {
  width: 40px;
  height: 40px;
}

.compact .divider {
  margin: 0;
}

.compact .tool[data-tip]:hover::after {
  display: none;
}

.compact .draw-hint {
  font-size: var(--text-xs);
}
</style>
