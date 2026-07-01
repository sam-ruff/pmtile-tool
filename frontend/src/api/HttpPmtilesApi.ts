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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let message = `request failed (${response.status})`
    let estimatedTiles: number | undefined
    let maxTiles: number | undefined
    try {
      const body = await response.json()
      if (typeof body.error === 'string') message = body.error
      if (typeof body.estimated_tiles === 'number') estimatedTiles = body.estimated_tiles
      if (typeof body.max_tiles === 'number') maxTiles = body.max_tiles
    } catch {
      // non-JSON error body, keep the generic message
    }
    throw new ApiRequestError(response.status, message, estimatedTiles, maxTiles)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export class HttpPmtilesApi implements PmtilesApi {
  listRegions(): Promise<RegionSummary[]> {
    return request('/api/v1/regions')
  }

  regionDetail(id: string): Promise<RegionDetail> {
    return request(`/api/v1/regions/${encodeURIComponent(id)}`)
  }

  regionGeometry(id: string): Promise<GeoJSONGeometry> {
    return request(`/api/v1/regions/${encodeURIComponent(id)}/geometry`)
  }

  requestRegionExtract(id: string): Promise<JobView> {
    return request(`/api/v1/regions/${encodeURIComponent(id)}/extract`, { method: 'POST' })
  }

  createExport(geometry: GeoJSONGeometry, maxzoom: number): Promise<JobView> {
    return request('/api/v1/exports', postJson({ geometry, maxzoom }))
  }

  estimateExport(geometry: GeoJSONGeometry, maxzoom: number): Promise<Estimate> {
    return request('/api/v1/exports/estimate', postJson({ geometry, maxzoom }))
  }

  getExport(id: string): Promise<JobView> {
    return request(`/api/v1/exports/${encodeURIComponent(id)}`)
  }

  deleteExport(id: string): Promise<void> {
    return request(`/api/v1/exports/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  status(): Promise<StatusView> {
    return request('/api/v1/status')
  }
}
