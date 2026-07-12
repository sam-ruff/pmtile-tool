<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import {
  FLAVOUR_GROUPS,
  FLAVOUR_LABELS,
  FLAVOUR_NAMES,
  LANDCOVER_FIELDS,
  POIS_FIELDS,
  fieldLabel,
  resolveFlavour,
  toHexColour,
} from '../map/flavours'
import type { CustomMapStyle, FlavourGroup } from '../map/flavours'
import { mapController } from '../map/controller'
import { useStylesStore } from '../stores/styles'

const props = defineProps<{ editing: CustomMapStyle | null }>()
const emit = defineEmits<{ close: [] }>()

const styles = useStylesStore()

const draft = reactive<CustomMapStyle>({
  id: props.editing?.id ?? `custom-${crypto.randomUUID()}`,
  name: props.editing?.name ?? '',
  base: props.editing?.base ?? styles.selected.base,
  overrides: JSON.parse(JSON.stringify(props.editing?.overrides ?? {})),
})

const resolved = computed(() => resolveFlavour(draft.base, draft.overrides))

const curatedGroups = FLAVOUR_GROUPS.filter((g) => g.curated)
// Single-field curated groups are already precise; everything else gets
// per-field controls for fine tuning.
const advancedGroups = FLAVOUR_GROUPS.filter((g) => !g.curated || g.fields.length > 1)

const hasPois = computed(() => resolved.value.pois !== undefined)
const hasLandcover = computed(() => resolved.value.landcover !== undefined)

function groupValue(group: FlavourGroup): string {
  return toHexColour(resolved.value[group.fields[0]])
}

function groupOverridden(group: FlavourGroup): boolean {
  return group.fields.some((f) => f in draft.overrides)
}

function setGroup(group: FlavourGroup, colour: string) {
  for (const field of group.fields) draft.overrides[field] = colour
}

function resetGroup(group: FlavourGroup) {
  for (const field of group.fields) delete draft.overrides[field]
}

function fieldValue(field: FlavourGroup['fields'][number]): string {
  return toHexColour(resolved.value[field])
}

function setField(field: FlavourGroup['fields'][number], colour: string) {
  draft.overrides[field] = colour
}

function resetField(field: FlavourGroup['fields'][number]) {
  delete draft.overrides[field]
}

function poisValue(field: (typeof POIS_FIELDS)[number]): string {
  return toHexColour(resolved.value.pois?.[field] ?? '#000000')
}

function setPois(field: (typeof POIS_FIELDS)[number], colour: string) {
  draft.overrides.pois = { ...draft.overrides.pois, [field]: colour }
}

function landcoverValue(field: (typeof LANDCOVER_FIELDS)[number]): string {
  return toHexColour(resolved.value.landcover?.[field] ?? '#000000')
}

function setLandcover(field: (typeof LANDCOVER_FIELDS)[number], colour: string) {
  draft.overrides.landcover = { ...draft.overrides.landcover, [field]: colour }
}

function inputColour(event: Event): string {
  return (event.target as HTMLInputElement).value
}

const canSave = computed(() => draft.name.trim().length > 0)

// Edits restyle the live map (debounced) so colour picking is immediate.
let previewTimer: number | null = null
watch(
  () => [draft.base, JSON.stringify(draft.overrides)],
  () => {
    if (previewTimer !== null) window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(() => {
      mapController.setMapStyle({
        id: draft.id,
        name: draft.name.trim() || 'Custom style',
        base: draft.base,
        overrides: draft.overrides,
        flavor: resolved.value,
      })
    }, 150)
  },
  { immediate: true },
)

function save() {
  if (!canSave.value) return
  styles.upsertCustom(JSON.parse(JSON.stringify({ ...draft, name: draft.name.trim() })))
  styles.select(draft.id)
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

// Whatever closed the editor (save, cancel, backdrop), the map must end up on
// the persisted selection rather than an abandoned draft.
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (previewTimer !== null) window.clearTimeout(previewTimer)
  mapController.setMapStyle(styles.selected)
})
</script>

<template>
  <div class="editor-backdrop" @click.self="emit('close')">
    <div
      class="editor-card"
      role="dialog"
      aria-modal="true"
      :aria-label="props.editing ? 'Edit style' : 'New custom style'"
      data-testid="style-editor"
    >
      <header class="editor-header">
        <h2>{{ props.editing ? 'Edit style' : 'New custom style' }}</h2>
        <button class="btn-ghost" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <div class="editor-body">
        <label class="field">
          <span>Name</span>
          <input
            v-model="draft.name"
            type="text"
            placeholder="e.g. Night ops"
            data-testid="style-name"
          />
        </label>

        <label class="field">
          <span>Base preset</span>
          <select v-model="draft.base" data-testid="style-base">
            <option v-for="name in FLAVOUR_NAMES" :key="name" :value="name">
              {{ FLAVOUR_LABELS[name] }}
            </option>
          </select>
        </label>

        <div class="colour-rows">
          <div v-for="group in curatedGroups" :key="group.key" class="colour-row">
            <span class="colour-label">{{ group.label }}</span>
            <button
              v-if="groupOverridden(group)"
              class="btn-ghost reset"
              @click="resetGroup(group)"
            >
              Reset
            </button>
            <input
              type="color"
              :value="groupValue(group)"
              :data-testid="`colour-${group.key}`"
              :aria-label="`${group.label} colour`"
              @input="setGroup(group, inputColour($event))"
            />
          </div>
        </div>

        <details class="advanced">
          <summary>Advanced colours</summary>

          <section v-for="group in advancedGroups" :key="group.key">
            <p class="group-title">{{ group.label }}</p>
            <div class="colour-rows">
              <div v-for="field in group.fields" :key="field" class="colour-row">
                <span class="colour-label">{{ fieldLabel(field) }}</span>
                <button
                  v-if="field in draft.overrides"
                  class="btn-ghost reset"
                  @click="resetField(field)"
                >
                  Reset
                </button>
                <input
                  type="color"
                  :value="fieldValue(field)"
                  :data-testid="`colour-field-${field}`"
                  :aria-label="`${fieldLabel(field)} colour`"
                  @input="setField(field, inputColour($event))"
                />
              </div>
            </div>
          </section>

          <section v-if="hasPois">
            <p class="group-title">Points of interest</p>
            <div class="colour-rows">
              <div v-for="field in POIS_FIELDS" :key="field" class="colour-row">
                <span class="colour-label">{{ fieldLabel(field) }}</span>
                <input
                  type="color"
                  :value="poisValue(field)"
                  :aria-label="`POI ${fieldLabel(field)} colour`"
                  @input="setPois(field, inputColour($event))"
                />
              </div>
            </div>
          </section>

          <section v-if="hasLandcover">
            <p class="group-title">Low zoom landcover</p>
            <div class="colour-rows">
              <div v-for="field in LANDCOVER_FIELDS" :key="field" class="colour-row">
                <span class="colour-label">{{ fieldLabel(field) }}</span>
                <input
                  type="color"
                  :value="landcoverValue(field)"
                  :aria-label="`Landcover ${fieldLabel(field)} colour`"
                  @input="setLandcover(field, inputColour($event))"
                />
              </div>
            </div>
          </section>
        </details>
      </div>

      <footer class="editor-footer">
        <button class="btn" data-testid="style-cancel" @click="emit('close')">Cancel</button>
        <button
          class="btn-primary"
          data-testid="style-save"
          :disabled="!canSave"
          @click="save"
        >
          Save style
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.editor-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(28, 25, 23, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}

.editor-card {
  width: min(480px, calc(100vw - 32px));
  max-height: min(640px, calc(100dvh - 32px));
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.editor-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.editor-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field > span {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.field select {
  font: inherit;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
}

.colour-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.colour-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.colour-label {
  flex: 1;
}

.colour-row input[type='color'] {
  width: 40px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  cursor: pointer;
}

.reset {
  padding: 2px 8px;
  font-size: 12px;
}

.advanced summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--text-muted);
  padding: 4px 0;
}

.group-title {
  margin: 12px 0 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

@media (max-width: 720px) {
  .editor-card {
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
  }
}
</style>
