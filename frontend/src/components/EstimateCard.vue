<script setup lang="ts">
import { computed } from 'vue'
import { LoaderCircle } from '@lucide/vue'
import { formatBytes, formatCount } from '../format'
import { estimateVerdict, useDraftStore } from '../stores/draft'
import { useServerStore } from '../stores/server'

const draft = useDraftStore()
const server = useServerStore()

const share = computed(() =>
  draft.estimate ? Math.min(draft.estimate.bytes / server.limits.max_export_bytes, 1) : 0,
)
const verdict = computed(() =>
  draft.estimate ? estimateVerdict(draft.estimate, server.limits) : null,
)
</script>

<template>
  <section class="estimate" :class="verdict" aria-live="polite" data-testid="estimate">
    <div class="row">
      <span class="eyebrow">Estimated size</span>
      <span v-if="draft.estimating" class="hint working">
        <LoaderCircle :size="14" class="spin" /> Updating
      </span>
      <span v-else-if="draft.estimate" class="hint num">
        {{ formatCount(draft.estimate.tiles) }} tiles
      </span>
    </div>
    <template v-if="draft.estimate">
      <p class="size num">{{ formatBytes(draft.estimate.bytes) }}</p>
      <div
        class="meter"
        role="meter"
        :aria-valuenow="Math.round(share * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`Uses ${Math.round(share * 100)}% of the size limit`"
      >
        <i :style="{ width: `${Math.max(share * 100, 1.5)}%` }" />
      </div>
      <p v-if="verdict === 'too-large'" class="error-text">
        Over the {{ formatBytes(server.limits.max_export_bytes) }} limit. Lower the detail or
        remove part of the area.
      </p>
      <p v-else class="hint">
        {{ Math.max(1, Math.round(share * 100)) }}% of the
        {{ formatBytes(server.limits.max_export_bytes) }} limit per extract
      </p>
      <p v-if="!draft.estimate.measured" class="hint" data-testid="estimate-rough">
        A rough guess from the area's shape. The planet archive could not be measured, so the
        file may well be larger.
      </p>
    </template>
    <p v-else-if="draft.estimateError" class="error-text">{{ draft.estimateError }}</p>
    <p v-else-if="!draft.estimating" class="hint">Add something to your area to see a size.</p>
  </section>
</template>

<style scoped>
.estimate {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: var(--radius-lg);
  background: var(--surface-2);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.working {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.size {
  font-family: var(--font-head);
  font-size: var(--text-xl);
  font-weight: 700;
  line-height: 1.1;
}

.meter {
  height: 6px;
  border-radius: 6px;
  background: var(--surface-3);
  overflow: hidden;
}

.meter i {
  display: block;
  height: 100%;
  border-radius: 6px;
  background: var(--primary);
  transition: width 200ms ease;
}

.large .meter i {
  background: var(--warning);
}

.too-large .meter i {
  background: var(--danger);
}
</style>
