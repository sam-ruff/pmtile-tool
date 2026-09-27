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

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use utoipa::OpenApi;

    use super::ApiDoc;

    fn spec() -> Value {
        serde_json::to_value(ApiDoc::openapi()).expect("spec json")
    }

    fn schema<'a>(spec: &'a Value, name: &str) -> &'a Value {
        &spec["components"]["schemas"][name]
    }

    fn is_required(schema: &Value, field: &str) -> bool {
        schema["required"]
            .as_array()
            .is_some_and(|r| r.iter().any(|f| f == field))
    }

    #[test]
    fn spec_targets_openapi_3_1() {
        assert_eq!(spec()["openapi"], "3.1.0");
    }

    #[test]
    fn every_response_has_a_description() {
        let spec = spec();
        let paths = spec["paths"].as_object().expect("paths");
        for (path, item) in paths {
            let operations = item.as_object().expect("path item");
            for (method, operation) in operations {
                let responses = operation["responses"].as_object().expect("responses");
                for (status, response) in responses {
                    let description = response["description"].as_str().unwrap_or_default();
                    assert!(
                        !description.is_empty(),
                        "{method} {path} {status} has no description"
                    );
                }
            }
        }
    }

    #[test]
    fn documents_every_routed_path() {
        let spec = spec();
        let paths = spec["paths"].as_object().expect("paths");
        for path in [
            "/api/v1/regions",
            "/api/v1/regions/{id}",
            "/api/v1/regions/{id}/geometry",
            "/api/v1/regions/{id}/extract",
            "/api/v1/regions/{id}/download",
            "/api/v1/exports",
            "/api/v1/exports/estimate",
            "/api/v1/exports/{id}",
            "/api/v1/exports/{id}/download",
            "/api/v1/status",
        ] {
            assert!(paths.contains_key(path), "{path} missing from spec");
        }
    }

    #[test]
    fn optional_scalar_fields_are_nullable_and_not_required() {
        let spec = spec();
        let job = schema(&spec, "JobView");
        assert!(is_required(job, "id"));
        assert!(!is_required(job, "name"));
        let name_types = job["properties"]["name"]["type"]
            .as_array()
            .expect("name type list");
        assert!(name_types.iter().any(|t| t == "string"));
        assert!(name_types.iter().any(|t| t == "null"));
    }

    #[test]
    fn optional_reference_field_keeps_ref_and_null_variants() {
        let spec = spec();
        let detail = schema(&spec, "RegionDetail");
        assert!(!is_required(detail, "extract"));
        let variants = detail["properties"]["extract"]["oneOf"]
            .as_array()
            .expect("extract oneOf");
        assert_eq!(variants.len(), 2);
        assert!(
            variants
                .iter()
                .any(|v| v["$ref"] == "#/components/schemas/JobView")
        );
        assert!(variants.iter().any(|v| v["type"] == "null"));
    }
}
