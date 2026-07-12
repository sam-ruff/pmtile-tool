import { layers } from '@protomaps/basemaps'
import type { JobView } from '../api'
import type { ResolvedMapStyle } from './flavours'

const HOSTED_ASSETS = 'https://protomaps.github.io/basemaps-assets'

const ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>'

const USAGE_NOTE =
  'Load with the MapLibre pmtiles protocol plugin: ' +
  "maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile). " +
  'The source URL expires 48 hours after the export finished; download the ' +
  '.pmtiles file and repoint sources.protomaps.url at wherever you host it.'

/// A self-contained MapLibre style for the exported archive. Sprites and
/// glyphs come from the Protomaps-hosted assets because this app renders
/// labels with CSS fonts and serves no glyph endpoint of its own.
export function buildMaplibreStyle(job: JobView, style: ResolvedMapStyle): object {
  const pmtilesUrl = new URL(job.download_url ?? '', window.location.origin).toString()
  return {
    version: 8,
    name: `${job.name ?? job.id} - ${style.name}`,
    metadata: {
      'pmtile-tool:note': USAGE_NOTE,
      'pmtile-tool:style': { base: style.base, overrides: style.overrides },
    },
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution: ATTRIBUTION,
      },
    },
    sprite: `${HOSTED_ASSETS}/sprites/v4/${style.base}`,
    glyphs: `${HOSTED_ASSETS}/fonts/{fontstack}/{range}.pbf`,
    layers: layers('protomaps', style.flavor, { lang: 'en' }),
  }
}

/// Mirrors the backend's filename_for so the style pairs with the .pmtiles
/// download; hyena auto-detects a <stem>.style.json next to its tiles file.
export function styleFilename(job: JobView): string {
  const stem = (job.name ?? job.id).replace(/[^a-zA-Z0-9\-_]/g, '-').replace(/^-+|-+$/g, '')
  return `${stem}.style.json`
}

export function downloadJson(filename: string, data: object) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadStyleForJob(job: JobView, style: ResolvedMapStyle) {
  downloadJson(styleFilename(job), buildMaplibreStyle(job, style))
}
