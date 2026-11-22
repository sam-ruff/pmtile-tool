<script setup lang="ts">
import { computed } from 'vue'
import { useDraftStore, zoomDescription } from '../stores/draft'
import { useServerStore } from '../stores/server'
import EstimateCard from './EstimateCard.vue'

const draft = useDraftStore()
const server = useServerStore()

const max = computed(() => server.limits.max_maxzoom)
const fill = computed(() => ((draft.maxzoom - 1) / Math.max(max.value - 1, 1)) * 100)
const ticks = computed(() =>
  [
    { zoom: 3, label: 'Country' },
    { zoom: 8, label: 'Region' },
    { zoom: 11, label: 'Town' },
    { zoom: 14, label: 'Street' },
  ].filter((t) => t.zoom <= max.value),
)
</script>

<template>
  <div class="step-detail">
    <div class="intro">
      <h2>How much detail?</h2>
      <p class="muted">
        Higher zoom levels add streets, buildings and labels, and make the file much larger.
      </p>
    </div>

    <div class="zoom">
      <div class="zoom-head">
        <label for="maxzoom" class="label">
          Max zoom <span class="num">{{ draft.maxzoom }}</span>
        </label>
        <span class="hint">{{ zoomDescription(draft.maxzoom) }}</span>
      </div>
      <input
        id="maxzoom"
        v-model.number="draft.maxzoom"
        type="range"
        min="1"
        :max="max"
        step="1"
        :style="{ '--fill': `${fill}%` }"
        :aria-valuetext="`Zoom ${draft.maxzoom}: ${zoomDescription(draft.maxzoom)}`"
      />
      <div class="ticks" aria-hidden="true">
        <span
          v-for="t in ticks"
          :key="t.zoom"
          :style="{ left: `${((t.zoom - 1) / Math.max(max - 1, 1)) * 100}%` }"
          >{{ t.label }}</span
        >
      </div>
    </div>

    <EstimateCard />
  </div>
</template>

<style scoped>
.step-detail {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

h2 {
  font-size: var(--text-lg);
}

.zoom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.zoom-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 24px;
  background: transparent;
  margin: 0;
}

input[type='range']::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 6px;
  background: linear-gradient(
    to right,
    var(--primary) var(--fill),
    var(--surface-3) var(--fill)
  );
}

input[type='range']::-moz-range-track {
  height: 6px;
  border-radius: 6px;
  background: var(--surface-3);
}

input[type='range']::-moz-range-progress {
  height: 6px;
  border-radius: 6px;
  background: var(--primary);
}

input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -7px;
  border-radius: 50%;
  background: var(--surface);
  border: 3px solid var(--primary);
  box-shadow: var(--shadow-sm);
}

input[type='range']::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--surface);
  border: 3px solid var(--primary);
}

input[type='range']:focus-visible {
  box-shadow: none;
}

input[type='range']:focus-visible::-webkit-slider-thumb {
  box-shadow: var(--focus);
}

.ticks {
  position: relative;
  height: 16px;
  margin: 0 10px;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.ticks span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
</style>
