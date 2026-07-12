import { describe, expect, it } from 'vitest'
import { namedFlavor } from '@protomaps/basemaps'
import type { JobView } from '../../api'
import type { ResolvedMapStyle } from '../flavours'
import { resolveFlavour } from '../flavours'
import { buildMaplibreStyle, styleFilename } from '../styleExport'

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 'job-1',
    kind: 'custom',
    status: 'done',
    name: 'Cornwall',
    maxzoom: 15,
    estimated_tiles: 100,
    created_at: '2026-07-12T00:00:00Z',
    download_url: '/api/v1/exports/job-1/download',
    ...overrides,
  }
}

const darkStyle: ResolvedMapStyle = {
  id: 'dark',
  name: 'Dark',
  base: 'dark',
  overrides: {},
  flavor: namedFlavor('dark'),
}

interface GlLayer {
  id: string
  type: string
  source?: string
  paint?: Record<string, unknown>
}

describe('buildMaplibreStyle', () => {
  const style = buildMaplibreStyle(job(), darkStyle) as Record<string, unknown>

  it('is a version 8 style with a pmtiles source at the absolute download URL', () => {
    expect(style.version).toBe(8)
    const sources = style.sources as Record<string, { type: string; url: string }>
    expect(sources.protomaps.type).toBe('vector')
    expect(sources.protomaps.url).toBe(
      `pmtiles://${window.location.origin}/api/v1/exports/job-1/download`,
    )
  })

  it('uses the Protomaps hosted sprite and glyph assets', () => {
    expect(style.sprite).toBe('https://protomaps.github.io/basemaps-assets/sprites/v4/dark')
    expect(style.glyphs).toBe(
      'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    )
  })

  it('renders the flavour into layers pointing at the protomaps source', () => {
    const glLayers = style.layers as GlLayer[]
    expect(glLayers.length).toBeGreaterThan(0)
    expect(glLayers.filter((l) => l.type !== 'background').every((l) => l.source === 'protomaps')).toBe(true)
    const background = glLayers.find((l) => l.type === 'background')
    expect(background?.paint?.['background-color']).toBe(namedFlavor('dark').background)
  })

  it('embeds a usage note and the style recipe in metadata', () => {
    const metadata = style.metadata as Record<string, unknown>
    expect(metadata['pmtile-tool:note']).toContain('pmtiles')
    expect(metadata['pmtile-tool:note']).toContain('48 hours')
    expect(metadata['pmtile-tool:style']).toEqual({ base: 'dark', overrides: {} })
  })

  it('carries custom overrides through metadata and layers', () => {
    const custom: ResolvedMapStyle = {
      id: 'custom-1',
      name: 'Night ops',
      base: 'black',
      overrides: { water: '#001122' },
      flavor: resolveFlavour('black', { water: '#001122' }),
    }
    const built = buildMaplibreStyle(job(), custom) as Record<string, unknown>
    expect((built.metadata as Record<string, unknown>)['pmtile-tool:style']).toEqual({
      base: 'black',
      overrides: { water: '#001122' },
    })
    expect(built.name).toBe('Cornwall - Night ops')
    expect(JSON.stringify(built.layers)).toContain('#001122')
  })
})

describe('styleFilename', () => {
  it('pairs with the backend pmtiles filename', () => {
    expect(styleFilename(job({ name: 'My London Extract!' }))).toBe(
      'My-London-Extract.style.json',
    )
  })

  it('falls back to the job id without a name', () => {
    expect(styleFilename(job({ name: undefined }))).toBe('job-1.style.json')
  })
})
