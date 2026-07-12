import { ref } from 'vue'
import Feature from 'ol/Feature'
import Map from 'ol/Map'
import View from 'ol/View'
import GeoJSON from 'ol/format/GeoJSON'
import MVT from 'ol/format/MVT'
import VectorLayer from 'ol/layer/Vector'
import VectorTileLayer from 'ol/layer/VectorTile'
import VectorSource from 'ol/source/Vector'
import VectorTileSource from 'ol/source/VectorTile'
import { fromExtent } from 'ol/geom/Polygon'
import Draw, { createBox } from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import { transformExtent } from 'ol/proj'
import { Fill, Stroke, Style } from 'ol/style'
import { defaults as defaultControls, Attribution } from 'ol/control'
import { applyBackground, applyStyle } from 'ol-mapbox-style'
import { PMTilesVectorSource } from 'ol-pmtiles'
import { namedFlavor } from '@protomaps/basemaps'

import { useMockApi } from '../api'
import type { GeoJSONGeometry } from '../api'
import { glStyleForFlavour } from './flavours'
import type { ResolvedMapStyle } from './flavours'

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

const previewOutlineStyle = new Style({
  stroke: new Stroke({ color: '#0f766e', width: 2, lineDash: [6, 6] }),
  fill: new Fill({ color: 'rgba(15, 118, 110, 0.04)' }),
})

const defaultStyle: ResolvedMapStyle = {
  id: 'light',
  name: 'Light',
  base: 'light',
  overrides: {},
  flavor: namedFlavor('light'),
}

/// Singleton controller wiring the OpenLayers map to the panels.
class MapController {
  private map: Map | null = null
  private basemapLayer: VectorTileLayer | null = null
  private currentStyle: ResolvedMapStyle = defaultStyle
  private styleSeq = 0
  private stylePromise: Promise<void> = Promise.resolve()
  private highlightSource = new VectorSource()
  private drawSource = new VectorSource()
  private highlightLayer = new VectorLayer({
    source: this.highlightSource,
    style: highlightStyle,
    zIndex: 20,
  })
  private drawLayer = new VectorLayer({ source: this.drawSource, style: drawStyle, zIndex: 30 })
  private previewOutlineSource = new VectorSource()
  private previewOutlineLayer = new VectorLayer({
    source: this.previewOutlineSource,
    style: previewOutlineStyle,
    zIndex: 25,
  })
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
      layers: [this.highlightLayer, this.drawLayer, this.previewOutlineLayer],
      view: new View({ center: [0, 3_500_000], zoom: 2 }),
    })

    this.modify = new Modify({ source: this.drawSource })
    this.modify.on('modifyend', () => this.syncDrawnGeometry())
    this.map.addInteraction(this.modify)

    if (useMockApi || import.meta.env.DEV) {
      this.installTestHooks()
    }

    if (!useMockApi) {
      // A persistent layer (rather than ol-mapbox-style apply()) so switching
      // styles only swaps the style function and keeps the tile cache. The
      // attribution lives on the source because applyStyle with
      // updateSource:false never reads the gl style's source definition.
      this.basemapLayer = new VectorTileLayer({
        declutter: true,
        zIndex: 0,
        source: new VectorTileSource({
          format: new MVT(),
          urls: [`${window.location.origin}/tiles/planet/{z}/{x}/{y}`],
          maxZoom: 15,
          attributions:
            '© <a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank">Protomaps</a>',
        }),
      })
      this.map.addLayer(this.basemapLayer)
    }
    this.applyCurrentStyle()
  }

  /// Restyle the whole map (basemap and any active preview). Callable before
  /// init; the stored style is applied once the map exists.
  setMapStyle(style: ResolvedMapStyle) {
    this.currentStyle = style
    this.applyCurrentStyle()
  }

  /// Style applications are queued so rapid switches settle on the latest
  /// choice: applyStyle is async and two in-flight calls on one layer would
  /// otherwise finish in either order. Stale queue entries are skipped.
  private applyCurrentStyle() {
    const seq = ++this.styleSeq
    this.stylePromise = this.stylePromise
      .then(async () => {
        if (seq !== this.styleSeq) return
        const { flavor, base } = this.currentStyle
        if (this.basemapLayer) {
          const glStyle = glStyleForFlavour('planet', flavor, base)
          await applyStyle(this.basemapLayer, glStyle, {
            source: 'planet',
            updateSource: false,
          })
          // On the layer (never the map: that stacks background layers).
          await applyBackground(this.basemapLayer, glStyle)
        }
        if (this.previewLayer) {
          this.stylePreviewLayer(this.previewLayer)
        }
      })
      .catch((e: unknown) => {
        console.error('failed to apply map style', e)
      })
  }

  /// The preview gets the same flavour but no background, which would cover
  /// the basemap around the export bounds.
  private stylePreviewLayer(layer: VectorTileLayer) {
    const { flavor, base } = this.currentStyle
    applyStyle(layer, glStyleForFlavour('preview', flavor, base), {
      source: 'preview',
      updateSource: false,
    }).catch((e: unknown) => {
      console.error('failed to style export preview', e)
    })
  }

  destroy() {
    this.map?.setTarget(undefined)
    this.map = null
    this.basemapLayer = null
    this.previewLayer = null
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
  /// When bounds are given, the area is outlined and the view zooms to it so
  /// the export is always visible regardless of the current map position.
  setPreview(url: string | null, bounds?: [number, number, number, number]) {
    if (!this.map) return
    if (this.previewLayer) {
      this.map.removeLayer(this.previewLayer)
      this.previewLayer = null
    }
    this.previewOutlineSource.clear()
    this.previewUrl.value = url
    this.highlightLayer.setVisible(url === null)
    this.drawLayer.setVisible(url === null)
    if (!url) return
    this.stopDraw()
    if (bounds) {
      const extent = transformExtent(bounds, 'EPSG:4326', 'EPSG:3857')
      this.previewOutlineSource.addFeature(new Feature({ geometry: fromExtent(extent) }))
      this.map.getView().fit(extent, { padding: [56, 56, 56, 56], maxZoom: 14, duration: 300 })
    }
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
    this.stylePreviewLayer(this.previewLayer)
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
      styleId: () => this.currentStyle.id,
      styleBackground: () => this.currentStyle.flavor.background,
      styleWater: () => this.currentStyle.flavor.water,
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
