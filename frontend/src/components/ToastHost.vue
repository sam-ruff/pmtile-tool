<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, X } from '@lucide/vue'
import { useToastsStore } from '../stores/toasts'
import type { Toast } from '../stores/toasts'

const toasts = useToastsStore()

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info }

function act(toast: Toast) {
  toast.action?.()
  toasts.dismiss(toast.id)
}
</script>

<template>
  <div class="host" aria-live="polite">
    <div v-for="toast in toasts.toasts" :key="toast.id" class="toast surface" :class="toast.kind">
      <component :is="ICONS[toast.kind]" :size="18" class="icon" />
      <span class="text">{{ toast.text }}</span>
      <button v-if="toast.actionLabel" class="btn btn-ghost action" @click="act(toast)">
        {{ toast.actionLabel }}
      </button>
      <button class="icon-btn sm" aria-label="Dismiss" @click="toasts.dismiss(toast.id)">
        <X :size="15" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.host {
  position: absolute;
  left: calc(var(--panel-width) + 32px);
  right: 72px;
  bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 60;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 480px;
  padding: 8px 8px 8px 14px;
  border-radius: var(--radius-lg);
  pointer-events: auto;
  box-shadow: var(--shadow-lg);
}

.text {
  font-size: var(--text-sm);
}

.success .icon {
  color: var(--success);
}

.error .icon {
  color: var(--danger);
}

.info .icon {
  color: var(--primary);
}

.icon {
  flex: none;
}

.action {
  min-height: 32px;
  padding: 4px 10px;
  color: var(--primary-text);
}

@media (max-width: 720px) {
  .host {
    left: 8px;
    right: 8px;
    bottom: auto;
    top: 64px;
  }
}
</style>
