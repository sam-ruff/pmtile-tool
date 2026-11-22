<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Layers, Pencil, Plus, Trash2 } from '@lucide/vue'
import { namedFlavor } from '@protomaps/basemaps'
import type { Flavor } from '@protomaps/basemaps'
import { isFlavourName, resolveFlavour, toHexColour } from '../map/flavours'
import type { CustomMapStyle } from '../map/flavours'
import { useStylesStore } from '../stores/styles'
import StyleEditor from './StyleEditor.vue'

defineProps<{ compact: boolean }>()

const styles = useStylesStore()

const open = ref(false)
const editing = ref<CustomMapStyle | null>(null)
const editorOpen = ref(false)
const confirmingDelete = ref<string | null>(null)
let confirmTimer: number | null = null

const rootEl = ref<HTMLElement | null>(null)

const selectedName = computed(() => styles.selected.name)

function flavourFor(id: string): Flavor {
  if (isFlavourName(id)) return namedFlavor(id)
  const custom = styles.customs.find((c) => c.id === id)
  return custom ? resolveFlavour(custom.base, custom.overrides) : namedFlavor('light')
}

// A four-colour strip gives each row a recognisable fingerprint of the style.
function swatches(id: string): string[] {
  const flavor = flavourFor(id)
  return [flavor.background, flavor.earth, flavor.water, flavor.highway].map(toHexColour)
}

function selectStyle(id: string) {
  styles.select(id)
}

function newCustom() {
  editing.value = null
  editorOpen.value = true
  open.value = false
}

function editCustom(id: string) {
  editing.value = styles.customs.find((c) => c.id === id) ?? null
  editorOpen.value = editing.value !== null
  open.value = false
}

// First click arms, second click within a few seconds confirms.
function requestDelete(id: string) {
  if (confirmTimer !== null) window.clearTimeout(confirmTimer)
  if (confirmingDelete.value !== id) {
    confirmingDelete.value = id
    confirmTimer = window.setTimeout(() => {
      confirmingDelete.value = null
    }, 4000)
    return
  }
  confirmingDelete.value = null
  styles.removeCustom(id)
}

function onDocumentClick(event: MouseEvent) {
  if (!open.value || editorOpen.value || !rootEl.value) return
  // composedPath survives the clicked node being re-rendered away (the delete
  // button swaps its icon for "Confirm?" before this listener runs).
  if (!event.composedPath().includes(rootEl.value)) open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value && !editorOpen.value) {
    open.value = false
    event.stopPropagation()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown, true)
  if (confirmTimer !== null) window.clearTimeout(confirmTimer)
})
</script>

<template>
  <div ref="rootEl" class="style-picker">
    <button
      class="picker-button"
      :class="{ compact }"
      data-testid="style-picker-button"
      :aria-label="`Map style: ${selectedName}`"
      :aria-expanded="open"
      :data-tip="compact ? undefined : 'Map style'"
      @click="open = !open"
    >
      <Layers :size="18" :stroke-width="1.9" />
      <span v-if="!compact" class="picker-label">{{ selectedName }}</span>
    </button>

    <div v-if="open" class="picker-popover surface" data-testid="style-popover">
      <p class="eyebrow">Map style</p>
      <ul class="option-list">
        <li v-for="option in styles.options" :key="option.id">
          <div class="option-row" :class="{ selected: styles.selectedId === option.id }">
            <button
              class="option-select"
              :aria-pressed="styles.selectedId === option.id"
              :data-testid="`style-option-${option.id}`"
              @click="selectStyle(option.id)"
            >
              <span class="swatch-strip" aria-hidden="true">
                <span
                  v-for="(colour, i) in swatches(option.id)"
                  :key="i"
                  :style="{ background: colour }"
                />
              </span>
              <span class="option-name">{{ option.name }}</span>
            </button>
            <template v-if="option.custom">
              <button
                class="icon-btn sm"
                :aria-label="`Edit ${option.name}`"
                :data-testid="`style-edit-${option.id}`"
                @click="editCustom(option.id)"
              >
                <Pencil :size="15" />
              </button>
              <button
                class="btn btn-danger option-delete"
                :class="{ armed: confirmingDelete === option.id }"
                :aria-label="confirmingDelete === option.id ? `Confirm delete ${option.name}` : `Delete ${option.name}`"
                :data-testid="`style-delete-${option.id}`"
                @click="requestDelete(option.id)"
              >
                <template v-if="confirmingDelete === option.id">Confirm?</template>
                <Trash2 v-else :size="15" />
              </button>
            </template>
          </div>
        </li>
      </ul>
      <button class="btn btn-secondary btn-block" data-testid="style-new" @click="newCustom">
        <Plus :size="16" /> New custom style
      </button>
    </div>

    <StyleEditor v-if="editorOpen" :editing="editing" @close="editorOpen = false" />
  </div>
</template>

<style scoped>
.style-picker {
  position: relative;
}

.picker-button {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px 0 10px;
  border-radius: var(--radius);
  color: var(--text);
  font-weight: 600;
  font-size: var(--text-sm);
}

.picker-button.compact {
  width: 40px;
  height: 40px;
  padding: 0;
  justify-content: center;
}

.picker-button:hover,
.picker-button[aria-expanded='true'] {
  background: var(--surface-2);
}

.swatch-strip {
  display: inline-flex;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
  flex: none;
}

.swatch-strip span {
  width: 10px;
  height: 18px;
}

.picker-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: -5px;
  width: 272px;
  max-height: 60dvh;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 30;
}

.option-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius);
}

.option-row.selected {
  background: var(--primary-soft);
}

.option-select {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 8px;
  border-radius: var(--radius);
  text-align: left;
  min-width: 0;
}

.option-row:not(.selected) .option-select:hover {
  background: var(--surface-2);
}

.option-row.selected .option-name {
  font-weight: 600;
  color: var(--primary-text);
}

.option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-delete {
  min-height: 30px;
  padding: 4px 8px;
  font-size: var(--text-xs);
}

@media (max-width: 720px) {
  .picker-popover {
    position: fixed;
    top: 60px;
    left: 8px;
    right: 8px;
    width: auto;
  }
}
</style>
