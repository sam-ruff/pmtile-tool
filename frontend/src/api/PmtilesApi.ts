import type {
  Estimate,
  ExportArea,
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
  createExport(area: ExportArea, maxzoom: number, name?: string): Promise<JobView>
  estimateExport(area: ExportArea, maxzoom: number): Promise<Estimate>
  getExport(id: string): Promise<JobView>
  exportGeometry(id: string): Promise<GeoJSONGeometry>
  deleteExport(id: string): Promise<void>
  status(): Promise<StatusView>
}
