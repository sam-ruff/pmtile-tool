import type { PmtilesApi } from './PmtilesApi'
import {
  ApiRequestError,
  type Estimate,
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

/// Simulated job lifecycle so the whole UI works with no backend.
export class MockPmtilesApi implements PmtilesApi {
  private jobs = new Map<string, JobView>()
  private counter = 0

  private advance(id: string, sizeBytes: number) {
    setTimeout(() => {
      const job = this.jobs.get(id)
      if (job && job.status === 'queued') this.jobs.set(id, { ...job, status: 'running' })
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
    const job: JobView = {
      id,
      kind: 'region',
      status: 'queued',
      region_id: id,
      maxzoom: 15,
      estimated_tiles: 0,
      created_at: new Date().toISOString(),
    }
    this.jobs.set(id, job)
    this.advance(id, 48_000_000)
    return job
  }

  async createExport(geometry: GeoJSONGeometry, maxzoom: number): Promise<JobView> {
    const estimate = await this.estimateExport(geometry, maxzoom)
    if (estimate.tiles > 100_000_000) {
      throw new ApiRequestError(422, 'export too large', estimate.tiles, 100_000_000)
    }
    this.counter += 1
    const id = `mock-export-${this.counter}`
    const job: JobView = {
      id,
      kind: 'custom',
      status: 'queued',
      maxzoom,
      estimated_tiles: estimate.tiles,
      created_at: new Date().toISOString(),
    }
    this.jobs.set(id, job)
    this.advance(id, estimate.bytes)
    return job
  }

  async estimateExport(geometry: GeoJSONGeometry, maxzoom: number): Promise<Estimate> {
    // Rough mercator-free approximation, fine for mock mode.
    const rings =
      geometry.type === 'Polygon'
        ? (geometry.coordinates as number[][][])
        : (geometry.coordinates as number[][][][]).flat()
    let area = 0
    for (const ring of rings) {
      let sum = 0
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [x1 = 0, y1 = 0] = ring[i] ?? []
        const [x2 = 0, y2 = 0] = ring[i + 1] ?? []
        sum += x1 * y2 - x2 * y1
      }
      area += Math.abs(sum / 2) / (360 * 180)
    }
    let tiles = 0
    for (let z = 0; z <= maxzoom; z += 1) {
      tiles += area * 4 ** z + 1
    }
    tiles = Math.round(tiles)
    return { tiles, bytes: tiles * 85 }
  }

  async getExport(id: string): Promise<JobView> {
    const job = this.jobs.get(id)
    if (!job) throw new ApiRequestError(404, `unknown export job: ${id}`)
    return job
  }

  async deleteExport(id: string): Promise<void> {
    if (!this.jobs.delete(id)) throw new ApiRequestError(404, `unknown export job: ${id}`)
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
    }
  }
}
