<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JobView } from '../api'
import { formatBytes, formatCount, formatExpiry } from '../format'
import { mapController } from '../map/controller'
import { downloadStyleForJob } from '../map/styleExport'
import { useJobsStore } from '../stores/jobs'
import { useStylesStore } from '../stores/styles'

const jobs = useJobsStore()
const styles = useStylesStore()

const previewUrl = computed(() => mapController.previewUrl.value)
const confirmingDelete = ref<string | null>(null)
let confirmTimer: number | null = null

function isPreviewing(job: JobView): boolean {
  return Boolean(job.download_url && previewUrl.value?.includes(job.id))
}

function togglePreview(job: JobView) {
  if (!job.download_url) return
  if (isPreviewing(job)) {
    mapController.setPreview(null)
  } else {
    mapController.setPreview(
      new URL(job.download_url, window.location.origin).toString(),
      job.bounds,
    )
  }
}

// Deleting is destructive: the first click arms the button, a second within a
// few seconds confirms.
async function requestDelete(job: JobView) {
  if (confirmTimer !== null) window.clearTimeout(confirmTimer)
  if (confirmingDelete.value !== job.id) {
    confirmingDelete.value = job.id
    confirmTimer = window.setTimeout(() => {
      confirmingDelete.value = null
    }, 4000)
    return
  }
  confirmingDelete.value = null
  if (isPreviewing(job)) mapController.setPreview(null)
  await jobs.remove(job.id)
}
</script>

<template>
  <div class="jobs">
    <p v-if="jobs.ordered.length === 0" class="muted">
      No export jobs yet. Draw an area in the Custom export tab to create one. Jobs are remembered
      in this browser and their outputs stay downloadable for 48 hours.
    </p>

    <article v-for="job in jobs.ordered" :key="job.id" class="job" :data-testid="`job-${job.id}`">
      <header>
        <span class="name" :title="job.id">{{ job.name ?? job.id }}</span>
        <span class="badge" :class="`badge-${job.status}`">
          <span v-if="job.status === 'queued' || job.status === 'running'" class="spinner" />
          {{ job.status }}
        </span>
      </header>

      <p v-if="job.error" class="error-text">{{ job.error }}</p>
      <p v-else-if="job.status === 'done'" class="muted">
        z{{ job.maxzoom }} · {{ formatBytes(job.file_size) }} · {{ formatExpiry(job.expires_at) }}
      </p>
      <p v-else class="muted">z{{ job.maxzoom }} · ~{{ formatCount(job.estimated_tiles) }} tiles</p>

      <div class="actions">
        <template v-if="job.status === 'done'">
          <a class="btn-primary download-link" :href="job.download_url" download>Download</a>
          <button
            class="btn"
            :class="{ previewing: isPreviewing(job) }"
            @click="togglePreview(job)"
          >
            {{ isPreviewing(job) ? 'Hide preview' : 'Preview on map' }}
          </button>
          <button
            class="btn"
            :title="`MapLibre style.json using the ${styles.selected.name} style`"
            data-testid="download-style"
            @click="downloadStyleForJob(job, styles.selected)"
          >
            Download style
          </button>
        </template>
        <button
          class="btn-danger-ghost delete"
          :class="{ arming: confirmingDelete === job.id }"
          @click="requestDelete(job)"
        >
          {{ confirmingDelete === job.id ? 'Confirm delete?' : 'Delete' }}
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.jobs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.job {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.job header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.job header .name {
  flex: 1;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job p {
  margin: 0;
}

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.download-link {
  text-decoration: none;
  text-align: center;
  border-radius: var(--radius);
}

.btn.previewing {
  outline: 2px solid var(--preview);
  outline-offset: -2px;
}

.delete {
  margin-left: auto;
}

.delete.arming {
  background: #fef2f2;
  font-weight: 600;
}

.badge .spinner {
  width: 10px;
  height: 10px;
  margin-right: 4px;
}
</style>
