<script setup lang="ts">
import { computed } from 'vue'
import type { JobView } from '../api'
import { formatBytes, formatCount, formatExpiry } from '../format'
import { mapController } from '../map/controller'
import { useJobsStore } from '../stores/jobs'

const jobs = useJobsStore()

const previewId = computed(() => mapController.previewUrl.value)

function isPreviewing(job: JobView): boolean {
  return Boolean(job.download_url && previewId.value?.includes(job.id))
}

function togglePreview(job: JobView) {
  if (!job.download_url) return
  if (isPreviewing(job)) {
    mapController.setPreview(null)
  } else {
    mapController.setPreview(new URL(job.download_url, window.location.origin).toString())
  }
}

async function remove(job: JobView) {
  if (isPreviewing(job)) mapController.setPreview(null)
  await jobs.remove(job.id)
}
</script>

<template>
  <div class="jobs">
    <p v-if="jobs.ordered.length === 0" class="muted">
      No export jobs yet. Draw an area in the Custom export tab to create one.
    </p>

    <article v-for="job in jobs.ordered" :key="job.id" class="job">
      <header>
        <span class="badge" :class="`badge-${job.status}`">
          <span v-if="job.status === 'queued' || job.status === 'running'" class="spinner" />
          {{ job.status }}
        </span>
        <span class="muted id" :title="job.id">z{{ job.maxzoom }}</span>
        <button class="btn-danger-ghost" aria-label="Delete job" @click="remove(job)">
          Delete
        </button>
      </header>

      <p v-if="job.error" class="error-text">{{ job.error }}</p>
      <p v-else-if="job.status === 'done'" class="muted">
        {{ formatBytes(job.file_size) }} · {{ formatExpiry(job.expires_at) }}
      </p>
      <p v-else class="muted">~{{ formatCount(job.estimated_tiles) }} tiles</p>

      <div v-if="job.status === 'done'" class="actions">
        <a class="btn-primary download-link" :href="job.download_url" download>Download</a>
        <button class="btn" :class="{ previewing: isPreviewing(job) }" @click="togglePreview(job)">
          {{ isPreviewing(job) ? 'Hide preview' : 'Preview on map' }}
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
  gap: 8px;
}

.job header .id {
  flex: 1;
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

.badge .spinner {
  width: 10px;
  height: 10px;
  margin-right: 4px;
}
</style>
