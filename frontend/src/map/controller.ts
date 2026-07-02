import { ref } from 'vue'
import Feature from 'ol/Feature'
import Map from 'ol/Map'
import View from 'ol/View'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorTileLayer from 'ol/layer/VectorTile'
import VectorSource from 'ol/source/Vector'
import Draw, { createBox } from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import { Fill, Stroke, Style } from 'ol/style'
import { defaults as defaultControls, Attribution } from 'ol/control'
import { apply, applyStyle } from 'ol-mapbox-style'
import { PMTilesVectorSource } from 'ol-pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'

import { useMockApi } from '../api'
import type { GeoJSONGeometry } from '../api'

export type DrawMode = 'polygon' | 'rectangle'

const format = new GeoJSON()

const highlightStyle = new Style({
  stroke: new Stroke({ color: '#0f766e', width: 2 }),
  fill: new Fill({ color: 'rgba(15, 118, 110, 0.08)' }),
})

const drawStyle = new Style({
  stroke: new Stroke({ color: '#ea580c', width: 2, lineDash: [6, 6] }),
  fill: new Fill({ color: 'rgba(234, 88, 12, 0.08)' }),
})

/// Build the Protomaps gl style for a given source id, so both the planet
/// basemap and an export preview render with identical roads/labels/buildings.
function protomapsStyle(source: string) {
  return {
    version: 8,
    sprite: `${window.location.origin}/basemaps-assets/sprites/v4/light`,
    sources: { [source]: { type: 'vector' as const } },
    layers: layers(source, namedFlavor('light'), { lang: 'en' }),
  }
}

/// Singleton controller wiring the OpenLayers map to the panels.
class MapController {
  private map: Map | null = null
  private highlightSource = new VectorSource()
  private drawSource = new VectorSource()
  private highlightLayer = new VectorLayer({
    source: this.highlightSource,
    style: highlightStyle,
    zIndex: 20,
  })
  private drawLayer = new VectorLayer({ source: this.drawSource, style: drawStyle, zIndex: 30 })
  private previewLayer: VectorTileLayer | null = null
  private draw: Draw | null = null
  private modify: Modify | null = null

  /// Drawn export polygon in EPSG:4326, kept in sync with map edits.
  readonly drawnGeometry = ref<GeoJSONGeometry | null>(null)
  readonly drawMode = ref<DrawMode | null>(null)
  readonly previewUrl = ref<string | null>(null)

  init(target: HTMLElement) {
    if (this.map) return
    const attribution = new Attribution({ collapsible: false })
    this.map = new Map({
      target,
      controls: defaultControls({ attribution: false }).extend([attribution]),
      layers: [this.highlightLayer, this.drawLayer],
      view: new View({ center: [0, 3_500_000], zoom: 2 }),
    })

    this.modify = new Modify({ source: this.drawSource })
    this.modify.on('modifyend', () => this.syncDrawnGeometry())
    this.map.addInteraction(this.modify)

    if (useMockApi || import.meta.env.DEV) {
      this.installTestHooks()
    }

    if (!useMockApi) {
      const style = {
        version: 8,
        sprite: `${window.location.origin}/basemaps-assets/sprites/v4/light`,
        sources: {
          planet: {
            type: 'vector',
            tiles: [`${window.location.origin}/tiles/planet/{z}/{x}/{y}`],
            maxzoom: 15,
            attribution:
              '© <a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank">Protomaps</a>',
          },
        },
        layers: layers('planet', namedFlavor('light'), { lang: 'en' }),
      }
      apply(this.map, style).catch((e: unknown) => {
        console.error('failed to apply basemap style', e)
      })
    }
  }

  destroy() {
    this.map?.setTarget(undefined)
    this.map = null
  }

  highlightRegion(geometry: GeoJSONGeometry | null, fit = true) {
    this.highlightSource.clear()
    if (!geometry || !this.map) return
    const geom = format.readGeometry(geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    })
    this.highlightSource.addFeature(new Feature({ geometry: geom }))
    if (fit) {
      this.map.getView().fit(geom.getExtent(), {
        padding: [48, 48, 48, 48],
        maxZoom: 10,
        duration: 300,
      })
    }
  }

  startDraw(mode: DrawMode) {
    if (!this.map) return
    this.stopDraw()
    this.drawSource.clear()
    this.drawnGeometry.value = null
    this.draw = new Draw({
      source: this.drawSource,
      type: mode === 'rectangle' ? 'Circle' : 'Polygon',
      geometryFunction: mode === 'rectangle' ? createBox() : undefined,
      style: drawStyle,
    })
    this.draw.on('drawstart', () => this.drawSource.clear())
    this.draw.on('drawend', () => {
      this.stopDraw()
      // Source receives the feature after drawend fires.
      setTimeout(() => this.syncDrawnGeometry(), 0)
    })
    this.map.addInteraction(this.draw)
    this.drawMode.value = mode
  }

  stopDraw() {
    if (this.draw && this.map) {
      this.map.removeInteraction(this.draw)
    }
    this.draw = null
    this.drawMode.value = null
  }

  clearDrawn() {
    this.stopDraw()
    this.drawSource.clear()
    this.drawnGeometry.value = null
  }

  /// Preview mode shows ONLY the previewed archive: the region highlight and
  /// drawn export polygon are hidden (not cleared) until the preview closes.
  setPreview(url: string | null) {
    if (!this.map) return
    if (this.previewLayer) {
      this.map.removeLayer(this.previewLayer)
      this.previewLayer = null
    }
    this.previewUrl.value = url
    this.highlightLayer.setVisible(url === null)
    this.drawLayer.setVisible(url === null)
    if (!url) return
    this.stopDraw()
    // Declutter so labels from the export tiles place without overlapping.
    this.previewLayer = new VectorTileLayer({
      declutter: true,
      source: new PMTilesVectorSource({ url }),
      zIndex: 10,
    })
    this.map.addLayer(this.previewLayer)
    // Style the export with the same Protomaps layers as the basemap so the
    // preview shows roads, labels and buildings rather than flat outlines.
    // updateSource:false keeps the existing PMTiles source instead of trying
    // to rebuild it from the (source-less) style definition.
    applyStyle(this.previewLayer, protomapsStyle('preview'), {
      source: 'preview',
      updateSource: false,
    }).catch((e: unknown) => {
      console.error('failed to style export preview', e)
    })
  }

  /// State probes for the Playwright suite (mock/dev builds only).
  installTestHooks() {
    const target = window as unknown as Record<string, unknown>
    target.__pmtilesTest = {
      previewUrl: () => this.previewUrl.value,
      highlightLayerVisible: () => this.highlightLayer.getVisible(),
      drawLayerVisible: () => this.drawLayer.getVisible(),
      highlightCount: () => this.highlightSource.getFeatures().length,
      drawnCount: () => this.drawSource.getFeatures().length,
    }
  }

  private syncDrawnGeometry() {
    const feature = this.drawSource.getFeatures()[0]
    if (!feature) {
      this.drawnGeometry.value = null
      return
    }
    const geometry = feature.getGeometry()
    if (!geometry) return
    this.drawnGeometry.value = format.writeGeometryObject(geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
      decimals: 6,
    }) as GeoJSONGeometry
  }
}

export const mapController = new MapController()
