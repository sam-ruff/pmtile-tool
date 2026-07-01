export type JobKind = 'custom' | 'region'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'expired'

export interface JobView {
  id: string
  kind: JobKind
  status: JobStatus
  name?: string
  region_id?: string
  maxzoom: number
  estimated_tiles: number
  file_size?: number
  error?: string
  created_at: string
  finished_at?: string
  expires_at?: string
  download_url?: string
}

export interface RegionSummary {
  id: string
  name: string
  parent?: string
  has_children: boolean
}

export interface RegionDetail {
  id: string
  name: string
  parent?: string
  has_children: boolean
  extract?: JobView
}

export interface Estimate {
  tiles: number
  bytes: number
}

export interface StatusView {
  queued: number
  running: number
  disk_free_bytes: number
  region_cache_bytes: number
  version: string
}

export interface GeoJSONGeometry {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
}

export class ApiRequestError extends Error {
  status: number
  estimatedTiles?: number
  maxTiles?: number

  constructor(status: number, message: string, estimatedTiles?: number, maxTiles?: number) {
    super(message)
    this.status = status
    this.estimatedTiles = estimatedTiles
    this.maxTiles = maxTiles
  }
}
