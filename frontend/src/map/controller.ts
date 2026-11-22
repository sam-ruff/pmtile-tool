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
import type Geometry from 'ol/geom/Geometry'
import type { Extent } from 'ol/extent'
import { createEmpty, extend, isEmpty } from 'ol/extent'
import Draw, { createBox, createRegularPolygon } from 'ol/interaction/Draw'
import type { DrawEvent } from 'ol/interaction/Draw'
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom'
import Modify from 'ol/interaction/Modify'
import Select from 'ol/interaction/Select'
import { getArea } from 'ol/sphere'
import { transformExtent } from 'ol/proj'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import { MultiPoint } from 'ol/geom'
import type Polygon from 'ol/geom/Polygon'
import { Attribution, defaults as defaultControls } from 'ol/control'
import { applyBackground, applyStyle } from 'ol-mapbox-style'
import { PMTilesVectorSource } from 'ol-pmtiles'
import { namedFlavor } from '@protomaps/basemaps'

import { useMockApi } from '../api'
import type { GeoJSONGeometry } from '../api'
import type { DrawTool } from '../stores/selection'
import { glStyleForFlavour } from './flavours'
import type { ResolvedMapStyle } from './flavours'
import type { Bounds } from './geometry'
import { simplifyTolerance } from './geometry'

export type Tool = 'select' | DrawTool

/// Callbacks from map edits back to the app; keeps this controller store-free.
export interface MapListener {
  shapeAdded(id: string, tool: DrawTool, geometry: GeoJSONGeometry, areaKm2: number): void
  shapeChanged(id: string, geometry: GeoJSONGeometry, areaKm2: number): void
  shapeSelected(id: string | null): void
  removeRequested(id: string): void
}

const DRAW = '#ea580c'
const REGION = '#0d9488'
const PREVIEW = '#7c3aed'

const format = new GeoJSON()

const drawnStyle = new Style({
  stroke: new Stroke({ color: DRAW, width: 2, lineDash: [8, 6] }),
  fill: new Fill({ color: 'rgba(234, 88, 12, 0.12)' }),
})

const vertexStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: '#ffffff' }),
    stroke: new Stroke({ color: DRAW, width: 2 }),
  }),
  geometry: (feature) => {
    const geometry = feature.getGeometry() as Polygon | undefined
    if (!geometry || geometry.getType() !== 'Polygon') return undefined
    const ring = geometry.getCoordinates()[0] ?? []
    // Freehand and circle outlines are too dense to show every vertex.
    return ring.length <= 40 ? new MultiPoint(ring) : undefined
  },
})

const selectedStyle = [
  new Style({
    stroke: new Stroke({ color: DRAW, width: 3 }),
    fill: new Fill({ color: 'rgba(234, 88, 12, 0.2)' }),
  }),
  vertexStyle,
]

const sketchStyle = [
  new Style({
    stroke: new Stroke({ color: DRAW, width: 2.5 }),
    fill: new Fill({ color: 'rgba(234, 88, 12, 0.12)' }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: DRAW }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
  }),
]

const regionStyle = new Style({
  stroke: new Stroke({ color: REGION, width: 2.5 }),
  fill: new Fill({ color: 'rgba(13, 148, 136, 0.14)' }),
})

const inspectStyle = new Style({
  stroke: new Stroke({ color: REGION, width: 2, lineDash: [4, 6] }),
  fill: new Fill({ color: 'rgba(13, 148, 136, 0.05)' }),
})

const previewOutlineStyle = new Style({
  stroke: new Stroke({ color: PREVIEW, width: 2, lineDash: [6, 6] }),
  fill: new Fill({ color: 'rgba(124, 58, 237, 0.04)' }),
})

const defaultStyle: ResolvedMapStyle = {
  id: 'light',
  name: 'Light',
  base: 'light',
  overrides: {},
  flavor: namedFlavor('light'),
}

const READ_OPTS = { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }

function toGeoJSON(geometry: Geometry): GeoJSONGeometry {
  return format.writeGeometryObject(geometry, { ...READ_OPTS, decimals: 6 }) as GeoJSONGeometry
}

function readGeometry(geometry: GeoJSONGeometry): Geometry {
  return format.readGeometry(geometry, READ_OPTS)
}

function areaKm2(geometry: Geometry): number {
  return getArea(geometry) / 1_000_000
}

/// Singleton controller wiring the OpenLayers map to the panels.
class MapController {
  private map: Map | null = null
  private listener: MapListener | null = null
  private basemapLayer: VectorTileLayer | null = null
  private currentStyle: ResolvedMapStyle = defaultStyle
  private styleSeq = 0
  private stylePromise: Promise<void> = Promise.resolve()
  private shapeSeq = 0

  private drawSource = new VectorSource()
  private drawLayer = new VectorLayer({ source: this.drawSource, style: drawnStyle, zIndex: 30 })
  private regionSource = new VectorSource()
  private regionLayer = new VectorLayer({ source: this.regionSource, style: regionStyle, zIndex: 22 })
  private inspectSource = new VectorSource()
  private inspectLayer = new VectorLayer({ source: this.inspectSource, style: inspectStyle, zIndex: 20 })
  private previewOutlineSource = new VectorSource()
  private previewOutlineLayer = new VectorLayer({
    source: this.previewOutlineSource,
    style: previewOutlineStyle,
    zIndex: 25,
  })
  private previewLayer: VectorTileLayer | null = null

  private draw: Draw | null = null
  private select: Select | null = null
  private modify: Modify | null = null
  private dblClickZoom: DoubleClickZoom | null = null

  readonly tool = ref<Tool>('select')
  /// True while a shape is being sketched (between first click and finish).
  readonly sketching = ref(false)
  readonly selectedShapeId = ref<string | null>(null)
  readonly previewUrl = ref<string | null>(null)

  bind(listener: MapListener) {
    this.listener = listener
  }

  init(target: HTMLElement) {
    if (this.map) return
    const attribution = new Attribution({ collapsible: false })
    this.map = new Map({
      target,
      controls: defaultControls({ attribution: false, zoom: false, rotate: false }).extend([
        attribution,
      ]),
      layers: [this.inspectLayer, this.regionLayer, this.previewOutlineLayer, this.drawLayer],
      view: new View({ center: [0, 3_500_000], zoom: 2 }),
    })

    this.dblClickZoom =
      (this.map
        .getInteractions()
        .getArray()
        .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined) ?? null

    this.select = new Select({
      layers: [this.drawLayer],
      style: selectedStyle,
      hitTolerance: 6,
    })
    this.select.on('select', () => {
      const id = this.select?.getFeatures().item(0)?.getId()
      this.selectedShapeId.value = typeof id === 'string' ? id : null
      this.listener?.shapeSelected(this.selectedShapeId.value)
    })
    this.map.addInteraction(this.select)

    this.modify = new Modify({ features: this.select.getFeatures(), style: vertexStyle })
    this.modify.on('modifyend', (event) => {
      for (const feature of event.features.getArray()) {
        this.emitChanged(feature as Feature<Geometry>)
      }
    })
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

  destroy() {
    this.map?.setTarget(undefined)
    this.map = null
    this.basemapLayer = null
    this.previewLayer = null
    this.draw = null
    this.select = null
    this.modify = null
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

  zoomBy(delta: number) {
    const view = this.map?.getView()
    const zoom = view?.getZoom()
    if (!view || zoom === undefined) return
    view.animate({ zoom: zoom + delta, duration: 200 })
  }

  setTool(tool: Tool) {
    if (!this.map) return
    this.removeDraw()
    this.tool.value = tool
    this.select?.setActive(tool === 'select')
    this.modify?.setActive(tool === 'select')
    this.dblClickZoom?.setActive(tool === 'select')
    if (tool === 'select') return
    this.clearShapeSelection()

    this.draw = new Draw({
      source: this.drawSource,
      type: tool === 'rectangle' || tool === 'circle' ? 'Circle' : 'Polygon',
      freehand: tool === 'freehand',
      geometryFunction:
        tool === 'rectangle' ? createBox() : tool === 'circle' ? createRegularPolygon(64) : undefined,
      style: sketchStyle,
      stopClick: true,
    })
    this.draw.on('drawstart', () => {
      this.sketching.value = true
    })
    this.draw.on('drawabort', () => {
      this.sketching.value = false
    })
    this.draw.on('drawend', (event: DrawEvent) => this.onDrawEnd(event, tool))
    this.map.addInteraction(this.draw)
  }

  private onDrawEnd(event: DrawEvent, tool: DrawTool) {
    this.sketching.value = false
    const feature = event.feature as Feature<Geometry>
    let geometry = feature.getGeometry()
    if (!geometry) return
    if (tool === 'freehand') {
      const resolution = this.map?.getView().getResolution() ?? 1
      geometry = geometry.simplify(simplifyTolerance(resolution))
      feature.setGeometry(geometry)
    }
    const id = `shape-${++this.shapeSeq}`
    feature.setId(id)
    this.listener?.shapeAdded(id, tool, toGeoJSON(geometry), areaKm2(geometry))
  }

  private removeDraw() {
    if (this.draw && this.map) {
      this.draw.abortDrawing()
      this.map.removeInteraction(this.draw)
    }
    this.draw = null
    this.sketching.value = false
  }

  /// Drop the last placed polygon vertex while sketching.
  undoLastPoint() {
    this.draw?.removeLastPoint()
  }

  finishSketch() {
    this.draw?.finishDrawing()
  }

  /// Keyboard shortcuts; returns true when the key was handled.
  handleKey(key: string): boolean {
    if (key === 'Escape') {
      if (this.sketching.value) {
        this.draw?.abortDrawing()
        return true
      }
      if (this.tool.value !== 'select') {
        this.setTool('select')
        return true
      }
      if (this.selectedShapeId.value) {
        this.selectShape(null)
        this.listener?.shapeSelected(null)
        return true
      }
      return false
    }
    if (key === 'Enter' && this.sketching.value) {
      this.finishSketch()
      return true
    }
    if ((key === 'Backspace' || key === 'Delete') && this.sketching.value) {
      this.undoLastPoint()
      return true
    }
    if ((key === 'Backspace' || key === 'Delete') && this.selectedShapeId.value) {
      this.listener?.removeRequested(this.selectedShapeId.value)
      return true
    }
    if (this.sketching.value) return false
    const shortcuts: Record<string, Tool> = {
      v: 'select',
      r: 'rectangle',
      p: 'polygon',
      f: 'freehand',
      c: 'circle',
    }
    const tool = shortcuts[key.toLowerCase()]
    if (!tool) return false
    this.setTool(tool)
    return true
  }

  private emitChanged(feature: Feature<Geometry>) {
    const id = feature.getId()
    const geometry = feature.getGeometry()
    if (typeof id !== 'string' || !geometry) return
    this.listener?.shapeChanged(id, toGeoJSON(geometry), areaKm2(geometry))
  }

  /// Remove drawn features that are no longer part of the selection.
  syncShapes(ids: string[]) {
    const keep = new Set(ids)
    for (const feature of this.drawSource.getFeatures()) {
      const id = feature.getId()
      if (typeof id === 'string' && keep.has(id)) continue
      this.drawSource.removeFeature(feature)
      this.select?.getFeatures().remove(feature)
    }
    if (this.selectedShapeId.value && !keep.has(this.selectedShapeId.value)) {
      this.selectedShapeId.value = null
    }
  }

  selectShape(id: string | null) {
    this.clearShapeSelection()
    if (!id) return
    const feature = this.drawSource.getFeatureById(id)
    if (!feature || this.tool.value !== 'select') return
    this.select?.getFeatures().push(feature)
    this.selectedShapeId.value = id
  }

  private clearShapeSelection() {
    this.select?.getFeatures().clear()
    this.selectedShapeId.value = null
  }

  /// Catalogue regions that are part of the selection.
  setRegionShapes(regions: { id: string; geometry: GeoJSONGeometry }[]) {
    this.regionSource.clear()
    for (const region of regions) {
      const feature = new Feature({ geometry: readGeometry(region.geometry) })
      feature.setId(region.id)
      this.regionSource.addFeature(feature)
    }
  }

  /// Dashed outline of the region being looked at in the browser.
  inspectRegion(geometry: GeoJSONGeometry | null, fit = true) {
    this.inspectSource.clear()
    if (!geometry || !this.map) return
    const geom = readGeometry(geometry)
    this.inspectSource.addFeature(new Feature({ geometry: geom }))
    if (fit) this.fitExtent(geom.getExtent(), 10)
  }

  /// Fit the view to the given drawn shapes / regions (all when omitted).
  zoomToSelection(ids?: string[]) {
    const extent: Extent = createEmpty()
    const wanted = ids ? new Set(ids) : null
    for (const feature of [...this.drawSource.getFeatures(), ...this.regionSource.getFeatures()]) {
      const id = feature.getId()
      if (wanted && (typeof id !== 'string' || !wanted.has(id))) continue
      const geometry = feature.getGeometry()
      if (geometry) extend(extent, geometry.getExtent())
    }
    if (!isEmpty(extent)) this.fitExtent(extent, 13)
  }

  private fitExtent(extent: Extent, maxZoom: number) {
    this.map?.getView().fit(extent, {
      padding: this.fitPadding(),
      maxZoom,
      duration: 300,
    })
  }

  /// Keep fitted areas clear of the side panel (desktop) or sheet (phone).
  private fitPadding(): number[] {
    const panel = document.querySelector<HTMLElement>('[data-map-inset]')
    if (!panel) return [56, 56, 56, 56]
    const rect = panel.getBoundingClientRect()
    if (window.innerWidth <= 720) return [88, 32, Math.max(window.innerHeight - rect.top, 0) + 24, 32]
    return [80, 56, 56, rect.right + 40]
  }

  /// Preview mode shows ONLY the previewed archive: the selection layers are
  /// hidden (not cleared) until the preview closes. The archive's real shape
  /// is outlined when known, otherwise its bounding box.
  setPreview(url: string | null, outline?: GeoJSONGeometry | Bounds) {
    if (!this.map) return
    if (this.previewLayer) {
      this.map.removeLayer(this.previewLayer)
      this.previewLayer = null
    }
    this.previewOutlineSource.clear()
    this.previewUrl.value = url
    for (const layer of [this.inspectLayer, this.regionLayer, this.drawLayer]) {
      layer.setVisible(url === null)
    }
    if (!url) return
    this.setTool('select')
    this.clearShapeSelection()
    if (outline) {
      const geometry = Array.isArray(outline)
        ? fromExtent(transformExtent(outline, 'EPSG:4326', 'EPSG:3857'))
        : readGeometry(outline)
      this.previewOutlineSource.addFeature(new Feature({ geometry }))
      this.fitExtent(geometry.getExtent(), 14)
    }
    // Declutter so labels from the export tiles place without overlapping.
    this.previewLayer = new VectorTileLayer({
      declutter: true,
      source: new PMTilesVectorSource({ url }),
      zIndex: 10,
    })
    this.map.addLayer(this.previewLayer)
    this.stylePreviewLayer(this.previewLayer)
  }

  /// State probes for the Playwright suite (mock/dev builds only).
  private installTestHooks() {
    const target = window as unknown as Record<string, unknown>
    target.__pmtilesTest = {
      previewUrl: () => this.previewUrl.value,
      selectionVisible: () => this.drawLayer.getVisible() && this.regionLayer.getVisible(),
      drawnCount: () => this.drawSource.getFeatures().length,
      regionCount: () => this.regionSource.getFeatures().length,
      inspectCount: () => this.inspectSource.getFeatures().length,
      drawnVertexCounts: () =>
        this.drawSource.getFeatures().map((f) => {
          const geometry = f.getGeometry() as Polygon | undefined
          return geometry?.getCoordinates()[0]?.length ?? 0
        }),
      tool: () => this.tool.value,
      selectedShape: () => this.selectedShapeId.value,
      styleId: () => this.currentStyle.id,
      styleBackground: () => this.currentStyle.flavor.background,
      styleWater: () => this.currentStyle.flavor.water,
    }
  }
}

export const mapController = new MapController()
