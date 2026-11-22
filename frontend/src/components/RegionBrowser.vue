<script setup lang="ts">
import { computed } from 'vue'
import { Check, LoaderCircle, Plus, Search } from '@lucide/vue'
import { useAreaActions } from '../composables/useAreaActions'
import { useRegionsStore } from '../stores/regions'
import { useSelectionStore } from '../stores/selection'
import RegionInspector from './RegionInspector.vue'
import RegionTreeItem from './RegionTreeItem.vue'

const regions = useRegionsStore()
const selection = useSelectionStore()
const { toggleRegion, inspect, closeInspector } = useAreaActions()

const query = computed(() => regions.search.trim())

/// Split a name around the first match so it can be highlighted.
function parts(name: string): [string, string, string] {
  const at = name.toLowerCase().indexOf(query.value.toLowerCase())
  if (at < 0 || !query.value) return [name, '', '']
  return [name.slice(0, at), name.slice(at, at + query.value.length), name.slice(at + query.value.length)]
}

function inspectFromSearch(id: string) {
  regions.reveal(id)
  void inspect(id)
}
</script>

<template>
  <div class="browser">
    <label class="search">
      <Search :size="16" class="search-icon" />
      <span class="sr-only">Search regions</span>
      <input
        v-model="regions.search"
        class="input"
        type="search"
        placeholder="Search countries, nations and counties"
        aria-label="Search regions"
      />
    </label>

    <p v-if="regions.loadError" class="error-text">
      Could not load the region list: {{ regions.loadError }}
    </p>
    <p v-else-if="!regions.loaded" class="muted loading">
      <LoaderCircle :size="16" class="spin" /> Loading regions
    </p>

    <template v-else-if="query">
      <p v-if="regions.searchResults.length === 0" class="muted">
        Nothing matches "{{ query }}". Try a country or county name.
      </p>
      <ul v-else class="results" aria-label="Search results">
        <li v-for="result in regions.searchResults" :key="result.id" class="result">
          <button class="result-main" @click="inspectFromSearch(result.id)">
            <span class="result-name">
              {{ parts(result.name)[0] }}<mark>{{ parts(result.name)[1] }}</mark>{{ parts(result.name)[2] }}
            </span>
            <span v-if="regions.pathOf(result.id)" class="hint">{{ regions.pathOf(result.id) }}</span>
          </button>
          <button
            class="icon-btn"
            :class="{ added: selection.hasRegion(result.id) }"
            :aria-pressed="selection.hasRegion(result.id)"
            :aria-label="
              selection.hasRegion(result.id)
                ? `Remove ${result.name} from your area`
                : `Add ${result.name} to your area`
            "
            @click="toggleRegion(result.id)"
          >
            <Check v-if="selection.hasRegion(result.id)" :size="16" :stroke-width="2.4" />
            <Plus v-else :size="16" />
          </button>
        </li>
      </ul>
    </template>

    <ul v-else class="tree" role="tree" aria-label="Regions">
      <RegionTreeItem
        v-for="root in regions.roots"
        :key="root.id"
        :region="root"
        :depth="0"
        @inspect="inspect"
        @toggle-area="toggleRegion"
      />
    </ul>

    <RegionInspector class="docked" @toggle-area="toggleRegion" @close="closeInspector" />
  </div>
</template>

<style scoped>
.browser {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search {
  position: relative;
  display: block;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.search .input {
  padding-left: 36px;
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tree,
.results {
  margin: 0;
  padding: 0;
  list-style: none;
}

.result {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius);
}

.result:hover {
  background: var(--surface-2);
}

.result-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 6px 8px;
  text-align: left;
  border-radius: var(--radius);
}

.result-name {
  font-weight: 500;
}

mark {
  background: var(--primary-soft);
  color: var(--primary-text);
  border-radius: 3px;
  padding: 0 1px;
}

.icon-btn.added {
  color: var(--region);
}

/* Stays in view at the bottom of the scrolling panel while the tree scrolls. */
.docked {
  position: sticky;
  bottom: 0;
  box-shadow: var(--shadow-lg);
  z-index: 2;
}
</style>
