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
  // [west, south, east, north] in lon/lat.
  bounds?: [number, number, number, number]
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
  /** Measured from the planet archive; false when only approximated from the area's shape. */
  measured: boolean
}

export interface Limits {
  max_maxzoom: number
  max_export_bytes: number
  max_estimated_tiles: number
  max_polygon_vertices: number
  max_export_regions: number
  export_ttl_hours: number
}

export interface StatusView {
  queued: number
  running: number
  disk_free_bytes: number
  region_cache_bytes: number
  version: string
  limits?: Limits
}

export type GeoJSONGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

/// What an export is cut to: drawn shapes merged into one geometry plus any
/// catalogue regions, unioned server-side into a single archive.
export interface ExportArea {
  geometry?: GeoJSONGeometry
  regionIds: string[]
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
