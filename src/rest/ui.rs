use std::sync::OnceLock;

use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};

include!(concat!(env!("OUT_DIR"), "/static_files.rs"));

fn files() -> &'static HashMap<&'static str, &'static [u8]> {
    static FILES: OnceLock<HashMap<&'static str, &'static [u8]>> = OnceLock::new();
    FILES.get_or_init(static_files)
}

/// Serve the embedded SPA: exact asset matches first, then the SPA index for
/// route-like paths, 404 for anything that looks like a missing asset.
pub async fn serve_ui(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let key = if path.is_empty() { "index.html" } else { path };

    if let Some(bytes) = files().get(key) {
        return asset_response(key, bytes);
    }
    if !key.contains('.')
        && let Some(bytes) = files().get("index.html")
    {
        return asset_response("index.html", bytes);
    }
    (StatusCode::NOT_FOUND, "not found").into_response()
}

fn asset_response(key: &str, bytes: &'static [u8]) -> Response {
    let mime = mime_guess::from_path(key).first_or_octet_stream();
    let mut response = bytes.into_response();
    if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    // Vite emits content-hashed asset filenames, safe to cache aggressively.
    if key.starts_with("assets/") {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    }
    response
}
