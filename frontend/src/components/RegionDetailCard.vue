<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { formatBytes, formatExpiry } from '../format'
import { mapController } from '../map/controller'
import { useRegionsStore } from '../stores/regions'

const regions = useRegionsStore()

// Preview mode hides every other selection, this card included.
const visible = computed(() => regions.detail !== null && !mapController.previewUrl.value)
const extract = computed(() => regions.detail?.extract)
const extractActive = computed(
  () => extract.value?.status === 'queued' || extract.value?.status === 'running',
)

function close() {
  void regions.select(null)
  mapController.highlightRegion(null)
}

let pollHandle: number | null = null

// While the selected region generates, keep its status fresh.
watch(extractActive, (active) => {
  if (active && pollHandle === null) {
    pollHandle = window.setInterval(() => void regions.refreshDetail(), 2000)
  }
  if (!active && pollHandle !== null) {
    window.clearInterval(pollHandle)
    pollHandle = null
  }
})

onBeforeUnmount(() => {
  if (pollHandle !== null) window.clearInterval(pollHandle)
})
</script>

<template>
  <section v-if="visible && regions.detail" class="region-card" data-testid="region-card">
    <header>
      <h2>{{ regions.detail.name }}</h2>
      <button class="btn-ghost close" aria-label="Close region details" @click="close">×</button>
    </header>

    <p v-if="regions.detailError" class="error-text">{{ regions.detailError }}</p>

    <template v-if="extract?.status === 'done'">
      <p class="muted">
        {{ formatBytes(extract.file_size) }} · {{ formatExpiry(extract.expires_at) }}
      </p>
      <a class="btn-primary download-link" :href="extract.download_url" download>
        Download .pmtiles
      </a>
    </template>
    <template v-else-if="extractActive">
      <p class="muted">
        <span class="spinner" />
        {{ extract?.status === 'running' ? 'Generating extract...' : 'Queued...' }}
      </p>
    </template>
    <template v-else>
      <p v-if="extract?.status === 'failed'" class="error-text">
        Generation failed: {{ extract.error }}
      </p>
      <button
        class="btn-primary"
        :disabled="regions.extractPending"
        @click="regions.requestExtract()"
      >
        <span v-if="regions.extractPending" class="spinner" />
        Generate extract
      </button>
    </template>
  </section>
</template>

<style scoped>
.region-card {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 280px;
  padding: 16px;
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
}

.region-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.region-card h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.close {
  font-size: 16px;
  line-height: 1;
  padding: 2px 8px;
}

.download-link {
  display: inline-block;
  text-align: center;
  text-decoration: none;
  border-radius: var(--radius);
}

@media (max-width: 720px) {
  .region-card {
    top: 8px;
    left: 8px;
    right: 8px;
    width: auto;
  }
}
</style>
