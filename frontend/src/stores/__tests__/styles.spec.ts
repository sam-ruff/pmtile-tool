import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { namedFlavor } from '@protomaps/basemaps'
import { useStylesStore } from '../styles'
import type { CustomMapStyle } from '../../map/flavours'

const STYLES_KEY = 'pmtile-tool:map-styles'
const SELECTED_KEY = 'pmtile-tool:map-style-selected'

function custom(id = 'custom-1', overrides = {}): CustomMapStyle {
  return { id, name: 'My style', base: 'dark', overrides }
}

describe('styles store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to the light preset', () => {
    const store = useStylesStore()
    expect(store.selectedId).toBe('light')
    expect(store.selected.flavor).toEqual(namedFlavor('light'))
    expect(store.options.map((o) => o.id)).toEqual([
      'light',
      'dark',
      'white',
      'grayscale',
      'black',
    ])
  })

  it('select persists and resolves presets', () => {
    const store = useStylesStore()
    store.select('dark')
    expect(store.selected.flavor).toEqual(namedFlavor('dark'))
    expect(localStorage.getItem(SELECTED_KEY)).toBe('dark')
  })

  it('select falls back to light for unknown ids', () => {
    const store = useStylesStore()
    store.select('custom-does-not-exist')
    expect(store.selectedId).toBe('light')
  })

  it('upsertCustom saves, lists and resolves with overrides', () => {
    const store = useStylesStore()
    store.upsertCustom(custom('custom-1', { water: '#123456' }))
    store.select('custom-1')
    expect(store.options.at(-1)).toEqual({ id: 'custom-1', name: 'My style', custom: true })
    expect(store.selected.flavor.water).toBe('#123456')
    expect(store.selected.flavor.earth).toBe(namedFlavor('dark').earth)
    expect(JSON.parse(localStorage.getItem(STYLES_KEY) ?? '[]')).toHaveLength(1)
  })

  it('upsertCustom replaces an existing style by id', () => {
    const store = useStylesStore()
    store.upsertCustom(custom('custom-1', { water: '#111111' }))
    store.upsertCustom({ ...custom('custom-1', { water: '#222222' }), name: 'Renamed' })
    expect(store.customs).toHaveLength(1)
    expect(store.customs[0].name).toBe('Renamed')
    expect(store.customs[0].overrides.water).toBe('#222222')
  })

  it('removeCustom of the selected style falls back to its base', () => {
    const store = useStylesStore()
    store.upsertCustom(custom('custom-1'))
    store.select('custom-1')
    store.removeCustom('custom-1')
    expect(store.customs).toEqual([])
    expect(store.selectedId).toBe('dark')
    expect(localStorage.getItem(SELECTED_KEY)).toBe('dark')
  })

  it('restores customs and selection from storage', () => {
    localStorage.setItem(STYLES_KEY, JSON.stringify([custom('custom-9', { earth: '#010203' })]))
    localStorage.setItem(SELECTED_KEY, 'custom-9')
    const store = useStylesStore()
    expect(store.selected.id).toBe('custom-9')
    expect(store.selected.flavor.earth).toBe('#010203')
  })

  it('tolerates corrupt storage and stale selections', () => {
    localStorage.setItem(STYLES_KEY, 'not-json{')
    localStorage.setItem(SELECTED_KEY, 'custom-gone')
    const store = useStylesStore()
    expect(store.customs).toEqual([])
    // Unknown id resolves to light without mutating state.
    expect(store.selected.base).toBe('light')
  })

  it('drops malformed persisted entries', () => {
    localStorage.setItem(
      STYLES_KEY,
      JSON.stringify([custom('custom-1'), { id: 'bad', base: 'sepia' }, 42]),
    )
    const store = useStylesStore()
    expect(store.customs.map((c) => c.id)).toEqual(['custom-1'])
  })
})
