import {
  boundsOf as geometryBounds,
  countVertices,
  mergeGeometries,
  polygonsOf,
} from '../map/geometry'
import type { Bounds } from '../map/geometry'
import type { PmtilesApi } from './PmtilesApi'
import {
  ApiRequestError,
  type Estimate,
  type ExportArea,
  type Limits,
  type GeoJSONGeometry,
  type JobView,
  type RegionDetail,
  type RegionSummary,
  type StatusView,
} from './types'

interface MockRegion {
  summary: RegionSummary
  geometry: GeoJSONGeometry
}

function box(minLon: number, minLat: number, maxLon: number, maxLat: number): GeoJSONGeometry {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    ],
  }
}

function boundsOf(geometry: GeoJSONGeometry): Bounds | undefined {
  return geometryBounds([geometry]) ?? undefined
}

const REGIONS: MockRegion[] = [
  { summary: { id: 'europe', name: 'Europe', has_children: true }, geometry: box(-11, 35, 32, 61) },
  {
    summary: { id: 'united-kingdom', name: 'United Kingdom', parent: 'europe', has_children: true },
    geometry: box(-8.6, 49.9, 1.8, 60.9),
  },
  {
    summary: { id: 'england', name: 'England', parent: 'united-kingdom', has_children: true },
    geometry: box(-6.4, 49.9, 1.8, 55.8),
  },
  {
    summary: { id: 'cornwall', name: 'Cornwall', parent: 'england', has_children: false },
    geometry: box(-5.8, 49.9, -4.2, 50.9),
  },
  {
    summary: { id: 'devon', name: 'Devon', parent: 'england', has_children: false },
    geometry: box(-4.7, 50.2, -2.9, 51.2),
  },
  {
    summary: { id: 'scotland', name: 'Scotland', parent: 'united-kingdom', has_children: false },
    geometry: box(-7.7, 54.6, -0.7, 60.9),
  },
  {
    summary: { id: 'wales', name: 'Wales', parent: 'united-kingdom', has_children: false },
    geometry: box(-5.5, 51.3, -2.6, 53.5),
  },
  {
    summary: { id: 'germany', name: 'Germany', parent: 'europe', has_children: false },
    geometry: box(5.9, 47.2, 15.1, 55.1),
  },
]

const MOCK_JOBS_KEY = 'pmtile-tool:mock-jobs'

/** Roughly what land tiles cost in a real planet build. */
export const MOCK_BYTES_PER_TILE = 1500

export const MOCK_LIMITS: Limits = {
  max_maxzoom: 15,
  max_export_bytes: 10 * 1024 ** 3,
  max_estimated_tiles: 150_000_000,
  max_polygon_vertices: 1000,
  max_export_regions: 20,
  export_ttl_hours: 48,
}

/// Simulated job lifecycle so the whole UI works with no backend. Jobs are
/// persisted to localStorage so reloads behave like the real backend.
export class MockPmtilesApi implements PmtilesApi {
  private jobs = new Map<string, JobView>()
  private geometries = new Map<string, GeoJSONGeometry>()
  private counter = 0

  constructor() {
    try {
      const raw = localStorage.getItem(MOCK_JOBS_KEY)
      if (raw) {
        this.jobs = new Map(JSON.parse(raw) as [string, JobView][])
        this.counter = this.jobs.size
      }
    } catch {
      // storage unavailable; jobs just will not survive reloads
    }
  }

  private persist() {
    try {
      localStorage.setItem(MOCK_JOBS_KEY, JSON.stringify([...this.jobs.entries()]))
    } catch {
      // ignore
    }
  }

  private advance(id: string, sizeBytes: number) {
    setTimeout(() => {
      const job = this.jobs.get(id)
      if (job && job.status === 'queued') {
        this.jobs.set(id, { ...job, status: 'running' })
        this.persist()
      }
    }, 1200)
    setTimeout(() => {
      const job = this.jobs.get(id)
      if (job && job.status === 'running') {
        this.jobs.set(id, {
          ...job,
          status: 'done',
          file_size: sizeBytes,
          finished_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          download_url:
            job.kind === 'custom'
              ? `/api/v1/exports/${id}/download`
              : `/api/v1/regions/${id}/download`,
        })
        this.persist()
      }
    }, 3500)
  }

  async listRegions(): Promise<RegionSummary[]> {
    return REGIONS.map((r) => r.summary)
  }

  async regionDetail(id: string): Promise<RegionDetail> {
    const region = REGIONS.find((r) => r.summary.id === id)
    if (!region) throw new ApiRequestError(404, `unknown region: ${id}`)
    return { ...region.summary, extract: this.jobs.get(id) }
  }

  async regionGeometry(id: string): Promise<GeoJSONGeometry> {
    const region = REGIONS.find((r) => r.summary.id === id)
    if (!region) throw new ApiRequestError(404, `unknown region: ${id}`)
    return region.geometry
  }

  async requestRegionExtract(id: string): Promise<JobView> {
    const existing = this.jobs.get(id)
    if (existing && existing.status !== 'failed' && existing.status !== 'expired') {
      return existing
    }
    const region = REGIONS.find((r) => r.summary.id === id)
    const job: JobView = {
      id,
      kind: 'region',
      status: 'queued',
      region_id: id,
      maxzoom: 15,
      estimated_tiles: 0,
      created_at: new Date().toISOString(),
      bounds: region ? boundsOf(region.geometry) : undefined,
    }
    this.jobs.set(id, job)
    this.persist()
    this.advance(id, 48_000_000)
    return job
  }

  /// Mirrors the server's composition: drawn polygons plus catalogue regions
  /// as one MultiPolygon (overlaps are not unioned in mock mode).
  private compose(area: ExportArea): GeoJSONGeometry {
    const parts: GeoJSONGeometry[] = []
    if (area.geometry) {
      if (countVertices(area.geometry) > MOCK_LIMITS.max_polygon_vertices) {
        throw new ApiRequestError(
          400,
          `geometry has ${countVertices(area.geometry)} vertices, the maximum is ${MOCK_LIMITS.max_polygon_vertices}`,
        )
      }
      parts.push(area.geometry)
    }
    const regionIds = [...new Set(area.regionIds)]
    if (regionIds.length > MOCK_LIMITS.max_export_regions) {
      throw new ApiRequestError(
        400,
        `at most ${MOCK_LIMITS.max_export_regions} regions can be combined in one export`,
      )
    }
    for (const id of regionIds) {
      const region = REGIONS.find((r) => r.summary.id === id)
      if (!region) throw new ApiRequestError(400, `unknown region: ${id}`)
      parts.push(region.geometry)
    }
    const merged = mergeGeometries(parts)
    if (!merged) throw new ApiRequestError(400, 'an export needs a drawn area or at least one region')
    return merged
  }

  async createExport(area: ExportArea, maxzoom: number, name?: string): Promise<JobView> {
    const estimate = await this.estimateExport(area, maxzoom)
    if (estimate.tiles > MOCK_LIMITS.max_estimated_tiles) {
      throw new ApiRequestError(
        422,
        'export too large',
        estimate.tiles,
        MOCK_LIMITS.max_estimated_tiles,
      )
    }
    const geometry = this.compose(area)
    this.counter += 1
    const id = `mock-export-${this.counter}`
    const job: JobView = {
      id,
      kind: 'custom',
      status: 'queued',
      name: name?.trim() || `mock-ridge-${this.counter}`,
      maxzoom,
      estimated_tiles: estimate.tiles,
      created_at: new Date().toISOString(),
      bounds: boundsOf(geometry),
    }
    this.jobs.set(id, job)
    this.geometries.set(id, geometry)
    this.persist()
    this.advance(id, estimate.bytes)
    return job
  }

  async exportGeometry(id: string): Promise<GeoJSONGeometry> {
    const job = this.jobs.get(id)
    if (!job || job.kind !== 'custom') {
      throw new ApiRequestError(404, `unknown export job: ${id}`)
    }
    const geometry = this.geometries.get(id)
    if (geometry) return geometry
    const [w = 0, s = 0, e = 0, n = 0] = job.bounds ?? []
    return box(w, s, e, n)
  }

  async estimateExport(exportArea: ExportArea, maxzoom: number): Promise<Estimate> {
    const geometry = this.compose(exportArea)
    // Rough mercator-free approximation, fine for mock mode.
    const rings = polygonsOf(geometry).flat()
    let fraction = 0
    for (const ring of rings) {
      let sum = 0
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [x1 = 0, y1 = 0] = ring[i] ?? []
        const [x2 = 0, y2 = 0] = ring[i + 1] ?? []
        sum += x1 * y2 - x2 * y1
      }
      fraction += Math.abs(sum / 2) / (360 * 180)
    }
    let tiles = 0
    for (let z = 0; z <= maxzoom; z += 1) {
      tiles += fraction * 4 ** z + 1
    }
    tiles = Math.round(tiles)
    return { tiles, bytes: tiles * MOCK_BYTES_PER_TILE, measured: true }
  }

  async getExport(id: string): Promise<JobView> {
    const job = this.jobs.get(id)
    if (!job) throw new ApiRequestError(404, `unknown export job: ${id}`)
    return job
  }

  async deleteExport(id: string): Promise<void> {
    if (!this.jobs.delete(id)) throw new ApiRequestError(404, `unknown export job: ${id}`)
    this.persist()
  }

  async status(): Promise<StatusView> {
    const active = [...this.jobs.values()].filter(
      (j) => j.status === 'queued' || j.status === 'running',
    )
    return {
      queued: active.filter((j) => j.status === 'queued').length,
      running: active.filter((j) => j.status === 'running').length,
      disk_free_bytes: 500_000_000_000,
      region_cache_bytes: 42_000_000_000,
      version: 'mock',
      limits: MOCK_LIMITS,
    }
  }
}
