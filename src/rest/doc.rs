use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "pmtile-tool API",
        description = "Create and download PMTiles basemap extracts: prerendered Geofabrik-style regions or custom polygon export jobs, cut from a planet archive. Extracts derive from OpenStreetMap data (ODbL) via Protomaps basemap builds."
    ),
    paths(
        super::regions::list_regions,
        super::regions::region_detail,
        super::regions::region_geometry,
        super::regions::region_extract,
        super::download::download_region,
        super::exports::create_export,
        super::exports::estimate_export,
        super::exports::get_export,
        super::exports::delete_export,
        super::download::download_export,
        super::status::status,
    ),
    components(schemas(
        crate::regions::RegionSummary,
        super::regions::RegionDetail,
        super::views::JobView,
        super::exports::ExportRequestBody,
        super::status::StatusView,
        crate::extract::estimate::Estimate,
        crate::jobs::JobKind,
        crate::jobs::JobStatus,
        crate::error::ErrorBody,
    )),
    tags(
        (name = "regions", description = "Geofabrik-style region hierarchy and extracts"),
        (name = "exports", description = "Custom polygon export jobs"),
        (name = "status", description = "Service status")
    )
)]
pub struct ApiDoc;
