<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Download, Eye, EyeOff, FileBraces, Inbox, Package, Trash2, X } from '@lucide/vue'
import { api } from '../api'
import type { GeoJSONGeometry } from '../api'
import { formatBytes, formatCount, formatElapsed, formatExpiry } from '../format'
import { mapController } from '../map/controller'
import { downloadStyleForJob } from '../map/styleExport'
import { isActive, useJobsStore } from '../stores/jobs'
import type { DownloadEntry } from '../stores/jobs'
import { useRegionsStore } from '../stores/regions'
import { useStylesStore } from '../stores/styles'

const emit = defineEmits<{ close: [] }>()

const jobs = useJobsStore()
const regions = useRegionsStore()
const styles = useStylesStore()

const previewUrl = computed(() => mapController.previewUrl.value)
const confirming = ref<string | null>(null)
const now = ref(Date.now())
const closeBtn = ref<HTMLButtonElement | null>(null)
let clock: number | null = null

const STATUS_LABELS = {
  queued: 'Queued',
  running: 'Cutting tiles',
  done: 'Ready',
  failed: 'Failed',
  expired: 'Expired',
} as const

function pendingMeta(entry: DownloadEntry): string {
  const parts = [`Zoom ${entry.job.maxzoom}`]
  if (entry.job.estimated_tiles) parts.push(`about ${formatCount(entry.job.estimated_tiles)} tiles`)
  parts.push(`started ${formatElapsed(entry.job.created_at, now.value)}`)
  return parts.join(', ')
}

function absoluteUrl(entry: DownloadEntry): string | null {
  return entry.job.download_url
    ? new URL(entry.job.download_url, window.location.origin).toString()
    : null
}

function isPreviewing(entry: DownloadEntry): boolean {
  const url = absoluteUrl(entry)
  return url !== null && previewUrl.value === url
}

async function outlineFor(entry: DownloadEntry): Promise<GeoJSONGeometry | undefined> {
  try {
    if (entry.kind === 'custom') return await api().exportGeometry(entry.job.id)
    return (await regions.geometry(entry.job.region_id ?? entry.job.id)) ?? undefined
  } catch {
    return undefined
  }
}

async function togglePreview(entry: DownloadEntry) {
  const url = absoluteUrl(entry)
  if (!url) return
  if (isPreviewing(entry)) {
    mapController.setPreview(null)
    return
  }
  const outline = (await outlineFor(entry)) ?? entry.job.bounds
  mapController.setPreview(url, outline)
  if (window.innerWidth <= 720) emit('close')
}

async function remove(entry: DownloadEntry) {
  confirming.value = null
  if (isPreviewing(entry)) mapController.setPreview(null)
  if (entry.kind === 'custom') {
    await jobs.remove(entry.job.id)
  } else {
    jobs.untrackRegion(entry.job.region_id ?? entry.job.id)
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  if (confirming.value) {
    confirming.value = null
    return
  }
  emit('close')
}

onMounted(() => {
  clock = window.setInterval(() => (now.value = Date.now()), 15_000)
  closeBtn.value?.focus()
})

onBeforeUnmount(() => {
  if (clock !== null) window.clearInterval(clock)
})
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown="onKeydown">
    <aside
      class="drawer surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="downloads-title"
      data-testid="downloads"
    >
      <header class="head">
        <h2 id="downloads-title">Downloads</h2>
        <button ref="closeBtn" class="icon-btn" aria-label="Close downloads" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>

      <div class="body">
        <div v-if="jobs.downloads.length === 0" class="empty">
          <Inbox :size="28" class="empty-icon" />
          <p class="label">No downloads yet</p>
          <p class="muted">
            Extracts you create in this browser show up here while they are prepared and for as
            long as they are kept.
          </p>
          <button class="btn btn-secondary" @click="emit('close')">Create an extract</button>
        </div>

        <ul v-else class="list">
          <li
            v-for="entry in jobs.downloads"
            :key="entry.key"
            class="job"
            :class="{ previewing: isPreviewing(entry) }"
            :data-testid="`job-${entry.job.id}`"
          >
            <div class="top">
              <span class="kind" :title="entry.kind === 'region' ? 'Ready-made region' : 'Custom extract'">
                <Package v-if="entry.kind === 'region'" :size="15" />
              </span>
              <span class="name" :title="entry.title">{{ entry.title }}</span>
              <span class="chip" :class="`chip-${entry.job.status}`">
                <span class="chip-dot" />{{ STATUS_LABELS[entry.job.status] }}
              </span>
            </div>

            <div v-if="isActive(entry.job)" class="progress" aria-hidden="true"><i /></div>

            <p v-if="entry.job.error" class="error-text">{{ entry.job.error }}</p>
            <p v-else-if="entry.job.status === 'done'" class="hint num">
              {{ formatBytes(entry.job.file_size) }}, zoom {{ entry.job.maxzoom }},
              {{ formatExpiry(entry.job.expires_at) }}
            </p>
            <p v-else class="hint num">{{ pendingMeta(entry) }}</p>

            <div v-if="confirming === entry.key" class="confirm" role="group" aria-label="Confirm delete">
              <span class="muted">
                {{ entry.kind === 'custom' ? 'Delete this file for everyone?' : 'Remove from this list?' }}
              </span>
              <button class="btn btn-ghost" @click="confirming = null">Cancel</button>
              <button class="btn btn-danger armed" data-testid="confirm-delete" @click="remove(entry)">
                {{ entry.kind === 'custom' ? 'Delete' : 'Remove' }}
              </button>
            </div>
            <div v-else class="actions">
              <template v-if="entry.job.status === 'done'">
                <a class="btn btn-primary" :href="entry.job.download_url" download>
                  <Download :size="16" /> Download
                </a>
                <button
                  class="btn btn-secondary"
                  :aria-pressed="isPreviewing(entry)"
                  @click="togglePreview(entry)"
                >
                  <EyeOff v-if="isPreviewing(entry)" :size="16" />
                  <Eye v-else :size="16" />
                  {{ isPreviewing(entry) ? 'Hide' : 'Preview' }}
                </button>
                <button
                  class="icon-btn"
                  :aria-label="`Download a MapLibre style using ${styles.selected.name}`"
                  :title="`MapLibre style.json (${styles.selected.name})`"
                  data-testid="download-style"
                  @click="downloadStyleForJob(entry.job, styles.selected)"
                >
                  <FileBraces :size="17" />
                </button>
              </template>
              <button
                class="icon-btn delete"
                :aria-label="entry.kind === 'custom' ? `Delete ${entry.title}` : `Remove ${entry.title} from the list`"
                :disabled="entry.job.status === 'running' && entry.kind === 'custom'"
                :title="entry.job.status === 'running' ? 'Cannot delete while running' : 'Delete'"
                @click="confirming = entry.key"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </li>
        </ul>
      </div>
      <p class="foot hint">
        Listed from this browser only. Anyone with a link can fetch a file until it expires.
      </p>
    </aside>
  </div>
</template>

<style scoped>
.scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
  z-index: 50;
}

.drawer {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: min(400px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 14px 18px;
  border-bottom: 1px solid var(--border);
}

h2 {
  font-size: var(--text-lg);
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.job {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.job.previewing {
  border-color: var(--preview);
  box-shadow: 0 0 0 2px var(--preview-soft);
}

.top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kind {
  display: inline-flex;
  color: var(--region);
}

.name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress {
  position: relative;
  height: 4px;
  border-radius: 4px;
  background: var(--surface-3);
  overflow: hidden;
}

.progress i {
  position: absolute;
  inset: 0 auto 0 0;
  width: 35%;
  border-radius: 4px;
  background: var(--warning);
  animation: slide 1.4s ease-in-out infinite;
}

@keyframes slide {
  from {
    left: -35%;
  }
  to {
    left: 100%;
  }
}

.actions,
.confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.actions .btn {
  min-height: 36px;
}

.delete {
  margin-left: auto;
}

.delete:hover:not(:disabled) {
  color: var(--danger);
  background: var(--danger-soft);
}

.confirm .muted {
  flex: 1 1 100%;
}

.confirm .btn {
  min-height: 34px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 32px 16px;
}

.empty-icon {
  color: var(--text-faint);
}

.empty .btn {
  margin-top: 10px;
}

.foot {
  padding: 10px 18px 14px;
  border-top: 1px solid var(--border);
}

@media (max-width: 720px) {
  .drawer {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
}
</style>
