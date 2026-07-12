import { describe, expect, it } from 'vitest'
import { namedFlavor } from '@protomaps/basemaps'
import type { Flavor } from '@protomaps/basemaps'
import {
  FLAVOUR_GROUPS,
  FLAVOUR_NAMES,
  fieldLabel,
  glStyleForFlavour,
  isFlavourName,
  resolveFlavour,
  toHexColour,
} from '../flavours'

describe('resolveFlavour', () => {
  it('returns the base preset untouched with no overrides', () => {
    expect(resolveFlavour('dark', {})).toEqual(namedFlavor('dark'))
  })

  it('applies flat overrides on top of the base', () => {
    const flavor = resolveFlavour('light', { water: '#123456', city_label: '#ff0000' })
    expect(flavor.water).toBe('#123456')
    expect(flavor.city_label).toBe('#ff0000')
    expect(flavor.earth).toBe(namedFlavor('light').earth)
  })

  it('merges nested pois and landcover overrides', () => {
    const flavor = resolveFlavour('light', {
      pois: { red: '#aa0000' },
      landcover: { forest: '#00aa00' },
    })
    expect(flavor.pois?.red).toBe('#aa0000')
    expect(flavor.pois?.blue).toBe(namedFlavor('light').pois?.blue)
    expect(flavor.landcover?.forest).toBe('#00aa00')
    expect(flavor.landcover?.barren).toBe(namedFlavor('light').landcover?.barren)
  })

  it('drops pois/landcover overrides when the base preset has none', () => {
    const flavor = resolveFlavour('white', { pois: { red: '#aa0000' } })
    expect(flavor.pois).toBeUndefined()
  })
})

describe('glStyleForFlavour', () => {
  it('builds a version 8 style with the base preset sprite', () => {
    const style = glStyleForFlavour('preview', namedFlavor('dark'), 'dark')
    expect(style.version).toBe(8)
    expect(style.sprite).toBe(`${window.location.origin}/basemaps-assets/sprites/v4/dark`)
    expect(style.sources.preview).toEqual({ type: 'vector' })
    expect(style.layers.length).toBeGreaterThan(0)
    expect(style.layers.every((l) => !('source' in l) || l.source === 'preview')).toBe(true)
  })
})

describe('toHexColour', () => {
  it('passes six digit hex through lowercased', () => {
    expect(toHexColour('#D2EFCF')).toBe('#d2efcf')
  })

  it('expands three digit hex', () => {
    expect(toHexColour('#fa0')).toBe('#ffaa00')
  })

  it('converts rgba to hex', () => {
    expect(toHexColour('rgba(210, 239, 207, 1)')).toBe('#d2efcf')
    expect(toHexColour('rgb(0, 128, 255)')).toBe('#0080ff')
  })

  it('falls back to black for unparseable values', () => {
    expect(toHexColour('tomato')).toBe('#000000')
  })
})

describe('FLAVOUR_GROUPS', () => {
  it('covers every flat flavour colour field exactly once', () => {
    const grouped = FLAVOUR_GROUPS.flatMap((g) => g.fields)
    expect(new Set(grouped).size).toBe(grouped.length)

    const flavor = namedFlavor('light')
    const flatFields = Object.entries(flavor)
      .filter(([, value]) => typeof value === 'string')
      .map(([key]) => key)
      .filter((key) => !['regular', 'bold', 'italic'].includes(key))
    expect([...grouped].sort()).toEqual([...flatFields].sort())
  })

  it('group fields all exist on every preset', () => {
    for (const name of FLAVOUR_NAMES) {
      const flavor = namedFlavor(name) as Flavor & Record<string, unknown>
      for (const group of FLAVOUR_GROUPS) {
        for (const field of group.fields) {
          expect(typeof flavor[field], `${name}.${field}`).toBe('string')
        }
      }
    }
  })
})

describe('helpers', () => {
  it('isFlavourName accepts the five presets only', () => {
    expect(FLAVOUR_NAMES.every(isFlavourName)).toBe(true)
    expect(isFlavourName('sepia')).toBe(false)
    expect(isFlavourName(undefined)).toBe(false)
  })

  it('fieldLabel humanises snake case', () => {
    expect(fieldLabel('roads_label_minor_halo')).toBe('Roads label minor halo')
  })
})
