<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, Globe } from '@lucide/vue'
import { formatBytes } from '../format'
import { useDraftStore, zoomDescription } from '../stores/draft'
import { useJobsStore } from '../stores/jobs'
import { useSelectionStore } from '../stores/selection'
import { useServerStore } from '../stores/server'

const props = defineProps<{ createdName: string | null; createdId: string | null }>()
const emit = defineEmits<{ openDownloads: []; startOver: []; editAgain: [] }>()

const draft = useDraftStore()
const jobs = useJobsStore()
const selection = useSelectionStore()
const server = useServerStore()

const createdStatus = computed(() =>
  props.createdId ? jobs.jobs[props.createdId]?.status : undefined,
)

const parts = computed(() => {
  const drawn = selection.drawn.length
  const regions = selection.regions.length
  const bits: string[] = []
  if (drawn) bits.push(`${drawn} drawn ${drawn === 1 ? 'shape' : 'shapes'}`)
  if (regions) bits.push(`${regions} ${regions === 1 ? 'region' : 'regions'}`)
  return bits.join(' and ')
})
</script>

<template>
  <div v-if="createdName" class="done" data-testid="export-created">
    <CircleCheck :size="36" class="done-icon" />
    <template v-if="createdStatus === 'done'">
      <h2>Extract ready</h2>
      <p class="muted"><strong>{{ createdName }}</strong> is ready in Downloads.</p>
    </template>
    <template v-else-if="createdStatus === 'failed'">
      <h2>Extract failed</h2>
      <p class="muted">
        <strong>{{ createdName }}</strong> could not be made. Downloads has the details.
      </p>
    </template>
    <template v-else>
      <h2>Extract started</h2>
      <p class="muted">
        <strong>{{ createdName }}</strong> is being cut now. It appears in Downloads and you will
        get a notice here when it is ready.
      </p>
    </template>
    <div class="done-actions">
      <button class="btn btn-primary" @click="emit('openDownloads')">Open downloads</button>
      <button class="btn btn-secondary" @click="emit('editAgain')">Adjust and export again</button>
      <button class="btn btn-ghost" @click="emit('startOver')">Start a new extract</button>
    </div>
  </div>

  <div v-else class="step-review">
    <div class="intro">
      <h2>Review and export</h2>
      <p class="muted">Everything below goes into one .pmtiles file.</p>
    </div>

    <dl class="summary">
      <div>
        <dt>Area</dt>
        <dd>{{ parts || 'Nothing selected' }}</dd>
      </div>
      <div>
        <dt>Detail</dt>
        <dd>Zoom {{ draft.maxzoom }}, {{ zoomDescription(draft.maxzoom).toLowerCase() }}</dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd class="num">{{ draft.estimate ? `About ${formatBytes(draft.estimate.bytes)}` : '-' }}</dd>
      </div>
      <div>
        <dt>Kept for</dt>
        <dd>{{ server.limits.export_ttl_hours }} hours</dd>
      </div>
    </dl>

    <div class="field">
      <label for="job-name" class="label">File name <span class="hint">(optional)</span></label>
      <input
        id="job-name"
        v-model="draft.name"
        class="input"
        type="text"
        maxlength="40"
        placeholder="We will pick one if you leave this blank"
      />
    </div>

    <div class="public-note" role="note">
      <Globe :size="18" />
      <p>
        Extracts are public. Anyone with the link can download the file and see its name, so
        leave out anything private.
      </p>
    </div>

    <p v-if="jobs.createError" class="error-text" role="alert">{{ jobs.createError }}</p>
  </div>
</template>

<style scoped>
.step-review,
.done {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

h2 {
  font-size: var(--text-lg);
}

.summary {
  margin: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.summary div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 12px;
  padding: 10px 14px;
}

.summary div + div {
  border-top: 1px solid var(--border);
}

dt {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

dd {
  margin: 0;
  font-weight: 600;
}

.public-note {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  background: var(--warning-soft);
  color: var(--text);
  font-size: var(--text-sm);
}

.public-note svg {
  color: var(--warning);
  flex: none;
  margin-top: 1px;
}

.done {
  align-items: center;
  text-align: center;
  padding: 16px 4px;
}

.done-icon {
  color: var(--success);
}

.done-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
}
</style>
