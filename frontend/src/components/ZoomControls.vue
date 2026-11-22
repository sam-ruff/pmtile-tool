<script setup lang="ts">
import { Minus, Plus } from '@lucide/vue'
import { mapController } from '../map/controller'
</script>

<template>
  <div class="zoom surface">
    <button class="zoom-btn" aria-label="Zoom in" @click="mapController.zoomBy(1)">
      <Plus :size="18" />
    </button>
    <button class="zoom-btn" aria-label="Zoom out" @click="mapController.zoomBy(-1)">
      <Minus :size="18" />
    </button>
  </div>
</template>

<style scoped>
.zoom {
  position: absolute;
  right: 16px;
  bottom: 32px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius);
  z-index: 15;
}

.zoom-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  color: var(--text);
}

.zoom-btn + .zoom-btn {
  border-top: 1px solid var(--border);
}

.zoom-btn:hover {
  background: var(--surface-2);
}

@media (max-width: 720px) {
  .zoom {
    right: 8px;
    bottom: auto;
    top: 96px;
  }
}
</style>
