<script setup lang="ts">
import { computed } from 'vue'
import { Check, ChevronRight, Plus } from '@lucide/vue'
import type { RegionSummary } from '../api'
import { useRegionsStore } from '../stores/regions'
import { useSelectionStore } from '../stores/selection'

const props = defineProps<{
  region: RegionSummary
  depth: number
}>()

const emit = defineEmits<{
  inspect: [id: string]
  toggleArea: [id: string]
}>()

const regions = useRegionsStore()
const selection = useSelectionStore()

const expanded = computed(() => regions.expanded.has(props.region.id))
const inspected = computed(() => regions.selectedId === props.region.id)
const added = computed(() => selection.hasRegion(props.region.id))
const children = computed(() => regions.childrenOf(props.region.id))
</script>

<template>
  <li
    role="treeitem"
    :aria-expanded="region.has_children ? expanded : undefined"
    :aria-selected="inspected"
  >
    <div class="row" :class="{ inspected }" :style="{ paddingLeft: `${4 + depth * 18}px` }">
      <button
        v-if="region.has_children"
        class="chevron"
        :class="{ open: expanded }"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${region.name}`"
        @click="regions.toggleExpanded(region.id)"
      >
        <ChevronRight :size="16" />
      </button>
      <span v-else class="chevron-spacer" />
      <button class="name" :data-testid="`region-${region.id}`" @click="emit('inspect', region.id)">
        {{ region.name }}
      </button>
      <button
        class="add"
        :class="{ added }"
        :aria-pressed="added"
        :aria-label="added ? `Remove ${region.name} from your area` : `Add ${region.name} to your area`"
        :title="added ? 'In your area' : 'Add to your area'"
        @click="emit('toggleArea', region.id)"
      >
        <Check v-if="added" :size="16" :stroke-width="2.4" />
        <Plus v-else :size="16" />
      </button>
    </div>
    <ul v-if="expanded" role="group">
      <RegionTreeItem
        v-for="child in children"
        :key="child.id"
        :region="child"
        :depth="depth + 1"
        @inspect="emit('inspect', $event)"
        @toggle-area="emit('toggleArea', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
li {
  list-style: none;
}

ul {
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 38px;
  border-radius: var(--radius);
}

.row:hover {
  background: var(--surface-2);
}

.row.inspected {
  background: var(--primary-soft);
}

.chevron,
.chevron-spacer {
  display: grid;
  place-items: center;
  width: 28px;
  height: 32px;
  flex: none;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}

.chevron svg {
  transition: transform 140ms ease;
}

.chevron.open svg {
  transform: rotate(90deg);
}

.name {
  flex: 1;
  min-width: 0;
  min-height: 34px;
  text-align: left;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row.inspected .name {
  color: var(--primary-text);
  font-weight: 600;
}

.add {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  opacity: 0;
}

.row:hover .add,
.row:focus-within .add,
.add.added {
  opacity: 1;
}

.add:hover {
  background: var(--surface-3);
  color: var(--text);
}

.add.added {
  color: var(--region);
}

@media (hover: none) {
  .add {
    opacity: 1;
  }
}
</style>
