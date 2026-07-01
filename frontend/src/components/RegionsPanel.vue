<script setup lang="ts">
import { mapController } from '../map/controller'
import { useRegionsStore } from '../stores/regions'
import RegionTreeItem from './RegionTreeItem.vue'

const regions = useRegionsStore()

async function select(id: string) {
  await regions.select(id)
  const geometry = await regions.geometry(id)
  mapController.highlightRegion(geometry)
}
</script>

<template>
  <div class="regions">
    <p class="muted intro">
      Download a ready-made extract for a region, from continents down to counties. Regions are
      generated on first request and cached; details appear in a card on the map.
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
</style>
