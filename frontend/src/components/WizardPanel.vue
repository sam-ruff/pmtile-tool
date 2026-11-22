<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, Download, LoaderCircle, Map as MapIcon } from '@lucide/vue'
import { STEPS, estimateVerdict, useDraftStore } from '../stores/draft'
import type { Step } from '../stores/draft'
import { useJobsStore } from '../stores/jobs'
import { useSelectionStore } from '../stores/selection'
import { useServerStore } from '../stores/server'
import StepArea from './StepArea.vue'
import StepDetail from './StepDetail.vue'
import StepReview from './StepReview.vue'

export type SheetSnap = 'peek' | 'half' | 'full'

const props = defineProps<{ compact: boolean; activeDownloads: number }>()
const snap = defineModel<SheetSnap>('snap', { required: true })
const emit = defineEmits<{ openDownloads: [] }>()

const draft = useDraftStore()
const jobs = useJobsStore()
const selection = useSelectionStore()
const server = useServerStore()

const createdName = ref<string | null>(null)
const createdId = ref<string | null>(null)

const overVertexCap = computed(
  () => selection.drawnVertexCount > server.limits.max_polygon_vertices,
)
const estimateBlocks = computed(() => {
  if (draft.estimateError) return true
  return draft.estimate ? estimateVerdict(draft.estimate, server.limits) === 'too-large' : false
})

function reachable(step: Step): boolean {
  if (step === 'area') return true
  if (selection.isEmpty || overVertexCap.value) return false
  if (step === 'detail') return true
  return !estimateBlocks.value
}

const stepIndex = computed(() => STEPS.findIndex((s) => s.id === draft.step))
const nextStep = computed(() => STEPS[stepIndex.value + 1])
const prevStep = computed(() => STEPS[stepIndex.value - 1])
const canCreate = computed(
  () => reachable('review') && !draft.estimating && Boolean(draft.estimate) && !jobs.creating,
)

// Losing the area (e.g. clearing it) sends people back to the start.
watch(
  () => selection.isEmpty,
  (empty) => {
    if (empty && !createdName.value) draft.goTo('area')
  },
)

let debounce: number | null = null
watch(
  [() => selection.exportArea, () => draft.maxzoom],
  () => {
    if (debounce !== null) window.clearTimeout(debounce)
    debounce = window.setTimeout(() => void draft.refreshEstimate(selection.exportArea), 300)
  },
  { deep: true, immediate: true },
)

function goTo(step: Step) {
  if (!reachable(step)) return
  createdName.value = null
  draft.goTo(step)
  if (props.compact && snap.value === 'peek') snap.value = 'half'
}

async function create() {
  const area = selection.exportArea
  if (!area || !canCreate.value) return
  const job = await jobs.createExport(area, draft.maxzoom, draft.name.trim() || undefined)
  if (!job) return
  createdName.value = job.name ?? job.id
  createdId.value = job.id
}

function startOver() {
  createdName.value = null
  selection.clear()
  draft.reset()
}

function editAgain() {
  createdName.value = null
  draft.goTo('area')
}

// Drag the sheet handle between peek, half and full.
const sheetEl = ref<HTMLElement | null>(null)
const dragOffset = ref<number | null>(null)
let dragStartY = 0
let dragStartHeight = 0

function onHandleDown(event: PointerEvent) {
  if (!props.compact || !sheetEl.value) return
  dragStartY = event.clientY
  dragStartHeight = sheetEl.value.getBoundingClientRect().height
  dragOffset.value = 0
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onHandleMove(event: PointerEvent) {
  if (dragOffset.value === null) return
  dragOffset.value = dragStartY - event.clientY
}

function onHandleUp() {
  if (dragOffset.value === null) return
  const moved = dragOffset.value
  const height = dragStartHeight + moved
  dragOffset.value = null
  if (Math.abs(moved) < 6) {
    snap.value = snap.value === 'peek' ? 'half' : snap.value === 'half' ? 'full' : 'peek'
    return
  }
  const vh = window.innerHeight
  if (height < vh * 0.32) snap.value = 'peek'
  else if (height < vh * 0.72) snap.value = 'half'
  else snap.value = 'full'
}

const sheetStyle = computed(() => {
  if (!props.compact || dragOffset.value === null) return undefined
  return { height: `${Math.max(dragStartHeight + dragOffset.value, 120)}px`, transition: 'none' }
})
</script>

<template>
  <aside
    ref="sheetEl"
    class="panel surface"
    :class="[compact ? `sheet sheet-${snap}` : 'side']"
    :style="sheetStyle"
    data-map-inset
    aria-label="Create an extract"
  >
    <button
      v-if="compact"
      class="handle"
      :aria-label="snap === 'full' ? 'Shrink panel' : 'Expand panel'"
      @pointerdown="onHandleDown"
      @pointermove="onHandleMove"
      @pointerup="onHandleUp"
      @pointercancel="onHandleUp"
    >
      <span />
    </button>

    <header class="head">
      <div v-if="!compact" class="brand-row">
        <h1 class="brand">
          <span class="brand-mark"><MapIcon :size="15" :stroke-width="2.2" /></span>
          PMTiles Extract
        </h1>
        <button
          class="btn btn-secondary downloads-btn"
          data-testid="open-downloads"
          @click="emit('openDownloads')"
        >
          <Download :size="16" />
          Downloads
          <span v-if="activeDownloads" class="badge num">{{ activeDownloads }}</span>
        </button>
      </div>
      <nav class="stepper" aria-label="Steps">
        <ol>
          <li v-for="(s, i) in STEPS" :key="s.id" class="step-wrap">
            <button
              class="step"
              :class="{
                current: draft.step === s.id,
                done: i < stepIndex,
              }"
              :aria-current="draft.step === s.id ? 'step' : undefined"
              :disabled="!reachable(s.id)"
              @click="goTo(s.id)"
            >
              <span class="step-dot">
                <Check v-if="i < stepIndex" :size="13" :stroke-width="3" />
                <template v-else>{{ i + 1 }}</template>
              </span>
              {{ s.label }}
            </button>
            <span v-if="i < STEPS.length - 1" class="step-line" aria-hidden="true" />
          </li>
        </ol>
      </nav>
    </header>

    <div class="body">
      <StepArea v-if="draft.step === 'area'" />
      <StepDetail v-else-if="draft.step === 'detail'" />
      <StepReview
        v-else
        :created-name="createdName"
        :created-id="createdId"
        @open-downloads="emit('openDownloads')"
        @start-over="startOver"
        @edit-again="editAgain"
      />
    </div>

    <footer v-if="!createdName" class="foot">
      <button
        class="btn btn-secondary"
        :disabled="!prevStep"
        @click="prevStep && goTo(prevStep.id)"
      >
        <ChevronLeft :size="16" /> Back
      </button>
      <button
        v-if="nextStep"
        class="btn btn-primary grow"
        :disabled="!reachable(nextStep.id)"
        data-testid="next-step"
        @click="goTo(nextStep.id)"
      >
        Next: {{ nextStep.label.toLowerCase() }} <ChevronRight :size="16" />
      </button>
      <button
        v-else
        class="btn btn-primary grow"
        :disabled="!canCreate"
        data-testid="create-extract"
        @click="create"
      >
        <LoaderCircle v-if="jobs.creating" :size="16" class="spin" />
        <Download v-else :size="16" />
        Create extract
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 20;
}

.side {
  position: absolute;
  top: 16px;
  left: 16px;
  bottom: 16px;
  width: var(--panel-width);
}

.head {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--border);
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 17px;
  font-weight: 700;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--primary);
  color: var(--on-primary);
}

.downloads-btn {
  position: relative;
  min-height: 34px;
  padding: 6px 10px;
}

.badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--draw);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
}

.stepper ol {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step-wrap {
  display: flex;
  align-items: center;
  flex: 1;
}

.step-wrap:last-child {
  flex: 0 0 auto;
}

.step {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 4px 4px 0;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.step:disabled {
  opacity: 0.55;
  cursor: default;
}

.step-dot {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: var(--text-xs);
}

.step.done .step-dot {
  background: var(--primary-soft);
  color: var(--primary-text);
}

.step.current {
  color: var(--text);
}

.step.current .step-dot {
  background: var(--primary);
  color: var(--on-primary);
}

.step-line {
  flex: 1;
  height: 2px;
  min-width: 12px;
  margin: 0 8px;
  background: var(--border);
  border-radius: 2px;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  overscroll-behavior: contain;
}

.foot {
  display: flex;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
}

.grow {
  flex: 1;
}

/* Phone bottom sheet */
.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  transition: height 220ms ease;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.sheet-peek {
  height: 170px;
}

.sheet-half {
  height: 54dvh;
}

.sheet-full {
  height: calc(100dvh - 64px);
}

.sheet .head {
  padding: 2px 16px 10px;
  gap: 8px;
}

.sheet .body {
  padding: 14px 16px;
}

.sheet .foot {
  padding: 10px 16px 14px;
}

.handle {
  display: grid;
  place-items: center;
  width: 100%;
  height: 22px;
  flex: none;
  touch-action: none;
  cursor: grab;
}

.handle span {
  width: 40px;
  height: 5px;
  border-radius: 4px;
  background: var(--border-strong);
}
</style>
