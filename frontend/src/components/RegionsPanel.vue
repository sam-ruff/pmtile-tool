<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { formatBytes, formatExpiry } from '../format'
import { mapController } from '../map/controller'
import { useRegionsStore } from '../stores/regions'
import RegionTreeItem from './RegionTreeItem.vue'

const regions = useRegionsStore()

const extract = computed(() => regions.detail?.extract)
const extractActive = computed(
  () => extract.value?.status === 'queued' || extract.value?.status === 'running',
)

async function select(id: string) {
  await regions.select(id)
  const geometry = await regions.geometry(id)
  mapController.highlightRegion(geometry)
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
  <div class="regions">
    <p class="muted intro">
      Download a ready-made extract for a region, from continents down to counties. Regions are
      generated on first request and cached.
    </p>

    <input
      v-model="regions.search"
      type="search"
      placeholder="Search regions, e.g. Devon"
      aria-label="Search regions"
    />

    <p v-if="regions.loadError" class="error-text">{{ regions.loadError }}</p>
    <p v-else-if="!regions.loaded" class="muted"><span class="spinner" /> Loading regions...</p>

    <div v-if="regions.search.trim()" class="tree">
      <p v-if="regions.searchResults.length === 0" class="muted">No matches.</p>
      <div
        v-for="result in regions.searchResults"
        :key="result.id"
        class="search-row"
        :class="{ selected: regions.selectedId === result.id }"
        @click="select(result.id)"
      >
        <span>{{ result.name }}</span>
        <span v-if="result.parent" class="muted">{{ result.parent }}</span>
      </div>
    </div>
    <div v-else class="tree">
      <RegionTreeItem
        v-for="root in regions.roots"
        :key="root.id"
        :region="root"
        :depth="0"
        @select="select"
      />
    </div>

    <section v-if="regions.detail" class="detail">
      <h2>{{ regions.detail.name }}</h2>
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
  </div>
</template>

<style scoped>
.regions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.intro {
  margin: 0;
}

.tree {
  display: flex;
  flex-direction: column;
}

.search-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-radius: var(--radius);
  cursor: pointer;
}

.search-row:hover {
  background: var(--surface-alt);
}

.search-row.selected {
  background: var(--primary-light);
}

.detail {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.download-link {
  display: inline-block;
  text-align: center;
  text-decoration: none;
  border-radius: var(--radius);
}
</style>
