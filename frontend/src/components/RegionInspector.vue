<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Download, LoaderCircle, Package, Plus, X } from '@lucide/vue'
import { api } from '../api'
import type { Estimate } from '../api'
import { formatBytes, formatExpiry } from '../format'
import { isActive, useJobsStore } from '../stores/jobs'
import { useRegionsStore } from '../stores/regions'
import { useSelectionStore } from '../stores/selection'
import { useServerStore } from '../stores/server'

const emit = defineEmits<{ toggleArea: [id: string]; close: [] }>()

const regions = useRegionsStore()
const selection = useSelectionStore()
const jobs = useJobsStore()
const server = useServerStore()

const detail = computed(() => regions.detail)
const added = computed(() => (detail.value ? selection.hasRegion(detail.value.id) : false))
const extract = computed(() =>
  detail.value ? (jobs.regionJobs[detail.value.id] ?? detail.value.extract) : undefined,
)
const working = computed(() => (extract.value ? isActive(extract.value) : false))
const ready = computed(() => extract.value?.status === 'done')
const requesting = ref(false)
const fullSize = ref<Estimate | null>(null)

// The ready-made file is cut at full detail, so show what that costs first.
watch(
  () => detail.value?.id,
  async (id) => {
    fullSize.value = null
    if (!id) return
    try {
      const estimate = await api().estimateExport({ regionIds: [id] }, server.limits.max_maxzoom)
      if (detail.value?.id === id) fullSize.value = estimate
    } catch {
      // size is a nicety; the button still works without it
    }
  },
  { immediate: true },
)

async function requestReadyMade() {
  if (!detail.value || requesting.value) return
  requesting.value = true
  await jobs.requestRegion(detail.value.id, detail.value.name)
  requesting.value = false
}
</script>

<template>
  <section v-if="detail" class="inspector" data-testid="region-card" aria-live="polite">
    <header>
      <div class="titles">
        <p v-if="regions.pathOf(detail.id)" class="hint">{{ regions.pathOf(detail.id) }}</p>
        <h3>{{ detail.name }}</h3>
      </div>
      <button class="icon-btn sm" aria-label="Close region details" @click="emit('close')">
        <X :size="16" />
      </button>
    </header>

    <button
      class="btn btn-block"
      :class="added ? 'btn-secondary' : 'btn-primary'"
      data-testid="region-toggle-area"
      @click="emit('toggleArea', detail.id)"
    >
      <template v-if="added"><Check :size="16" /> In your area</template>
      <template v-else><Plus :size="16" /> Add to your area</template>
    </button>

    <div class="ready-made">
      <Package :size="18" class="ready-icon" />
      <div class="ready-text">
        <p class="label">Ready-made download</p>
        <p class="hint">
          <template v-if="ready && extract">
            {{ formatBytes(extract.file_size) }} at full detail, {{ formatExpiry(extract.expires_at) }}
          </template>
          <template v-else-if="working">
            {{ extract?.status === 'running' ? 'Being prepared now' : 'Waiting in the queue' }}
          </template>
          <template v-else-if="fullSize">
            About {{ formatBytes(fullSize.bytes) }} at full detail, shared and cached for everyone
          </template>
          <template v-else>Full detail, shared and cached for everyone</template>
        </p>
        <p v-if="extract?.status === 'failed'" class="error-text">
          Last attempt failed: {{ extract.error }}
        </p>
      </div>
      <a
        v-if="ready && extract"
        class="btn btn-secondary"
        :href="extract.download_url"
        download
        data-testid="region-download"
      >
        <Download :size="16" /> Download
      </a>
      <button v-else-if="working" class="btn btn-secondary" disabled>
        <LoaderCircle :size="16" class="spin" /> Preparing
      </button>
      <button
        v-else
        class="btn btn-secondary"
        :disabled="requesting"
        data-testid="region-generate"
        @click="requestReadyMade"
      >
        Prepare
      </button>
    </div>
    <p v-if="regions.detailError" class="error-text">{{ regions.detailError }}</p>
  </section>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.titles {
  min-width: 0;
}

h3 {
  font-size: var(--text-lg);
}

.ready-made {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.ready-icon {
  color: var(--text-muted);
}

.ready-text {
  min-width: 0;
}
</style>
