<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { namedFlavor } from '@protomaps/basemaps'
import type { Flavor } from '@protomaps/basemaps'
import { isFlavourName, resolveFlavour, toHexColour } from '../map/flavours'
import type { CustomMapStyle } from '../map/flavours'
import { useStylesStore } from '../stores/styles'
import StyleEditor from './StyleEditor.vue'

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
}

function editCustom(id: string) {
  editing.value = styles.customs.find((c) => c.id === id) ?? null
  editorOpen.value = editing.value !== null
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
  if (!open.value || editorOpen.value) return
  if (rootEl.value && !rootEl.value.contains(event.target as Node)) {
    open.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !editorOpen.value) open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  if (confirmTimer !== null) window.clearTimeout(confirmTimer)
})
</script>

<template>
  <div ref="rootEl" class="style-picker">
    <button
      class="picker-button"
      data-testid="style-picker-button"
      aria-label="Map style"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="swatch-strip" aria-hidden="true">
        <span
          v-for="(colour, i) in swatches(styles.selectedId)"
          :key="i"
          :style="{ background: colour }"
        />
      </span>
      <span class="picker-label">{{ selectedName }}</span>
    </button>

    <div v-if="open" class="picker-popover" data-testid="style-popover">
      <p class="popover-title">Map style</p>
      <ul class="option-list">
        <li v-for="option in styles.options" :key="option.id">
          <div class="option-row" :class="{ selected: styles.selectedId === option.id }">
            <button
              class="option-select"
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
                class="btn-ghost option-action"
                :data-testid="`style-edit-${option.id}`"
                @click="editCustom(option.id)"
              >
                Edit
              </button>
              <button
                class="btn-danger-ghost option-action"
                :class="{ arming: confirmingDelete === option.id }"
                :data-testid="`style-delete-${option.id}`"
                @click="requestDelete(option.id)"
              >
                {{ confirmingDelete === option.id ? 'Confirm?' : 'Delete' }}
              </button>
            </template>
          </div>
        </li>
      </ul>
      <button class="btn new-custom" data-testid="style-new" @click="newCustom">
        New custom style
      </button>
    </div>

    <StyleEditor
      v-if="editorOpen"
      :editing="editing"
      @close="editorOpen = false"
    />
  </div>
</template>

<style scoped>
.style-picker {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 15;
}

.picker-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
  font-weight: 500;
}

.picker-button:hover {
  background: var(--surface-alt);
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
  height: 16px;
}

.picker-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 264px;
  max-height: 60dvh;
  overflow-y: auto;
  padding: 12px;
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow);
}

.popover-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
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
  gap: 4px;
  border-radius: var(--radius);
}

.option-row.selected {
  background: var(--primary-light);
}

.option-select {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  min-width: 0;
}

.option-row:not(.selected) .option-select:hover {
  background: var(--surface-alt);
}

.option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-action {
  flex: none;
  padding: 4px 8px;
  font-size: 12px;
}

.option-action.arming {
  background: #fef2f2;
  font-weight: 600;
}

.new-custom {
  width: 100%;
  margin-top: 8px;
}

@media (max-width: 720px) {
  /* The zoom control owns the top-right corner on mobile. */
  .style-picker {
    top: 8px;
    right: auto;
    left: 8px;
  }

  .picker-popover {
    right: auto;
    left: 0;
    width: min(280px, calc(100vw - 16px));
  }
}
</style>
