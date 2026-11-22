import { defineStore } from 'pinia'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
  actionLabel?: string
  action?: () => void
}

const DISMISS_MS = 6000
let seq = 0

export const useToastsStore = defineStore('toasts', {
  state: () => ({ toasts: [] as Toast[] }),

  actions: {
    push(kind: ToastKind, text: string, actionLabel?: string, action?: () => void): number {
      const id = ++seq
      this.toasts = [...this.toasts.slice(-2), { id, kind, text, actionLabel, action }]
      window.setTimeout(() => this.dismiss(id), DISMISS_MS)
      return id
    },

    dismiss(id: number) {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },
  },
})
