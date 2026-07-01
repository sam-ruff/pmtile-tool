<script setup lang="ts">
import { computed } from 'vue'
import type { RegionSummary } from '../api'
import { useRegionsStore } from '../stores/regions'

const props = defineProps<{
  region: RegionSummary
  depth: number
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const regions = useRegionsStore()

const expanded = computed(() => regions.expanded.has(props.region.id))
const selected = computed(() => regions.selectedId === props.region.id)
const children = computed(() => regions.childrenOf(props.region.id))
</script>

<template>
  <div>
    <div
      class="row"
      :class="{ selected }"
      :style="{ paddingLeft: `${8 + depth * 16}px` }"
      @click="emit('select', region.id)"
    >
      <button
        v-if="region.has_children"
        class="chevron"
        :class="{ open: expanded }"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click.stop="regions.toggleExpanded(region.id)"
      >
        ▸
      </button>
      <span v-else class="chevron-spacer" />
      <span class="name">{{ region.name }}</span>
    </div>
    <template v-if="expanded">
      <RegionTreeItem
        v-for="child in children"
        :key="child.id"
        :region="child"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: var(--radius);
  cursor: pointer;
}

.row:hover {
  background: var(--surface-alt);
}

.row.selected {
  background: var(--primary-light);
  color: var(--primary-dark);
  font-weight: 500;
}

.chevron {
  background: transparent;
  padding: 0 4px;
  color: var(--text-muted);
  transition: transform 120ms ease;
}

.chevron.open {
  transform: rotate(90deg);
}

.chevron-spacer {
  width: 16px;
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
