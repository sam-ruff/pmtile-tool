import { defineStore } from 'pinia'
import { namedFlavor } from '@protomaps/basemaps'
import {
  FLAVOUR_LABELS,
  FLAVOUR_NAMES,
  isFlavourName,
  resolveFlavour,
} from '../map/flavours'
import type { CustomMapStyle, ResolvedMapStyle } from '../map/flavours'

const STYLES_KEY = 'pmtile-tool:map-styles'
const SELECTED_KEY = 'pmtile-tool:map-style-selected'

function isCustomMapStyle(value: unknown): value is CustomMapStyle {
  if (typeof value !== 'object' || value === null) return false
  const style = value as Record<string, unknown>
  return (
    typeof style.id === 'string' &&
    typeof style.name === 'string' &&
    isFlavourName(style.base) &&
    typeof style.overrides === 'object' &&
    style.overrides !== null
  )
}

function loadCustoms(): CustomMapStyle[] {
  try {
    const raw = localStorage.getItem(STYLES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isCustomMapStyle) : []
  } catch {
    return []
  }
}

function saveCustoms(customs: CustomMapStyle[]) {
  try {
    localStorage.setItem(STYLES_KEY, JSON.stringify(customs))
  } catch {
    // storage unavailable (private browsing); styles just will not persist
  }
}

function loadSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? 'light'
  } catch {
    return 'light'
  }
}

function saveSelected(id: string) {
  try {
    localStorage.setItem(SELECTED_KEY, id)
  } catch {
    // storage unavailable; selection just will not persist
  }
}

/// Picker rows: the five presets followed by saved custom styles.
export interface StyleOption {
  id: string
  name: string
  custom: boolean
}

interface StylesState {
  customs: CustomMapStyle[]
  selectedId: string
}

export const useStylesStore = defineStore('styles', {
  state: (): StylesState => ({
    customs: loadCustoms(),
    selectedId: loadSelected(),
  }),

  getters: {
    options(state): StyleOption[] {
      return [
        ...FLAVOUR_NAMES.map((name) => ({
          id: name,
          name: FLAVOUR_LABELS[name],
          custom: false,
        })),
        ...state.customs.map((c) => ({ id: c.id, name: c.name, custom: true })),
      ]
    },

    selected(state): ResolvedMapStyle {
      if (isFlavourName(state.selectedId)) {
        return {
          id: state.selectedId,
          name: FLAVOUR_LABELS[state.selectedId],
          base: state.selectedId,
          overrides: {},
          flavor: namedFlavor(state.selectedId),
        }
      }
      const custom = state.customs.find((c) => c.id === state.selectedId)
      if (custom) {
        return {
          id: custom.id,
          name: custom.name,
          base: custom.base,
          overrides: custom.overrides,
          flavor: resolveFlavour(custom.base, custom.overrides),
        }
      }
      // Deleted custom or corrupt persisted id.
      return {
        id: 'light',
        name: FLAVOUR_LABELS.light,
        base: 'light',
        overrides: {},
        flavor: namedFlavor('light'),
      }
    },
  },

  actions: {
    select(id: string) {
      const known = isFlavourName(id) || this.customs.some((c) => c.id === id)
      this.selectedId = known ? id : 'light'
      saveSelected(this.selectedId)
    },

    upsertCustom(style: CustomMapStyle) {
      const index = this.customs.findIndex((c) => c.id === style.id)
      if (index === -1) {
        this.customs.push(style)
      } else {
        this.customs[index] = style
      }
      saveCustoms(this.customs)
    },

    removeCustom(id: string) {
      const removed = this.customs.find((c) => c.id === id)
      this.customs = this.customs.filter((c) => c.id !== id)
      saveCustoms(this.customs)
      if (this.selectedId === id) {
        this.select(removed?.base ?? 'light')
      }
    },
  },
})
