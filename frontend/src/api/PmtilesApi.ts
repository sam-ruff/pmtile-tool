import type {
  Estimate,
  GeoJSONGeometry,
  JobView,
  RegionDetail,
  RegionSummary,
  StatusView,
} from './types'

export interface PmtilesApi {
  listRegions(): Promise<RegionSummary[]>
  regionDetail(id: string): Promise<RegionDetail>
  regionGeometry(id: string): Promise<GeoJSONGeometry>
  requestRegionExtract(id: string): Promise<JobView>
  createExport(geometry: GeoJSONGeometry, maxzoom: number, name?: string): Promise<JobView>
  estimateExport(geometry: GeoJSONGeometry, maxzoom: number): Promise<Estimate>
  getExport(id: string): Promise<JobView>
  deleteExport(id: string): Promise<void>
  status(): Promise<StatusView>
}
