use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{
    CONNECTION, HOST, PROXY_AUTHENTICATE, PROXY_AUTHORIZATION, TE, TRAILER, TRANSFER_ENCODING,
    UPGRADE,
};
use axum::http::{HeaderMap, HeaderName, StatusCode};
use axum::response::Response;
use martin_embedded::{Config as MartinConfig, FileConfigEnum, MartinResult, ServerFuture};

use crate::config::AppConfig;
use crate::error::ApiError;
use crate::state::AppContext;

/// Build the embedded martin config: loopback listener, tiles served under
/// /tiles, and the planet archive as the only source (id = file stem "planet").
pub fn build_martin_config(app: &AppConfig) -> MartinConfig {
    let mut config = MartinConfig::default();
    config.srv.listen_addresses = Some(app.martin_listen.clone());
    config.srv.route_prefix = Some("/tiles".into());
    // Loopback-only service; the default of one worker per core is wasteful.
    config.srv.worker_processes = Some(4);
    config.pmtiles = FileConfigEnum::new(vec![app.planet_path()]);
    config
}

/// Start the embedded martin server. The returned future is !Send and must be
/// awaited on the task that created it (we select! on it in main).
pub async fn start_martin(app: &AppConfig) -> MartinResult<(ServerFuture, String)> {
    martin_embedded::start(build_martin_config(app)).await
}

#[derive(Debug, thiserror::Error)]
pub enum TileProxyError {
    #[error("tile server unreachable: {0}")]
    Unreachable(String),
}

/// A response streamed back from the internal tile server.
pub struct ProxiedResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Body,
}

/// The loopback HTTP call to the embedded martin server, behind a trait so
/// handler logic can be unit-tested with a mock.
#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait TileBackend: Send + Sync {
    async fn fetch(
        &self,
        path_and_query: &str,
        headers: HeaderMap,
    ) -> Result<ProxiedResponse, TileProxyError>;
}

pub struct HttpTileBackend {
    client: reqwest::Client,
    base_url: String,
}

impl HttpTileBackend {
    pub fn new(base_url: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url,
        }
    }
}

#[async_trait::async_trait]
impl TileBackend for HttpTileBackend {
    async fn fetch(
        &self,
        path_and_query: &str,
        headers: HeaderMap,
    ) -> Result<ProxiedResponse, TileProxyError> {
        let url = format!("{}{}", self.base_url, path_and_query);
        let resp = self
            .client
            .get(&url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| TileProxyError::Unreachable(e.to_string()))?;
        let status = resp.status();
        let headers = resp.headers().clone();
        let body = Body::from_stream(resp.bytes_stream());
        Ok(ProxiedResponse {
            status,
            headers,
            body,
        })
    }
}

const HOP_BY_HOP: [HeaderName; 7] = [
    CONNECTION,
    PROXY_AUTHENTICATE,
    PROXY_AUTHORIZATION,
    TE,
    TRAILER,
    TRANSFER_ENCODING,
    UPGRADE,
];

fn strip_hop_by_hop(headers: &HeaderMap) -> HeaderMap {
    let mut out = headers.clone();
    for name in HOP_BY_HOP {
        out.remove(&name);
    }
    out
}

/// Reverse proxy for /tiles/* onto the embedded martin server. Forwarded
/// headers (set by Traefik) pass through so martin generates public TileJSON
/// URLs; response bytes stream through untouched, including content-encoding.
pub async fn tiles_proxy(
    State(ctx): State<AppContext>,
    req: Request,
) -> Result<Response, ApiError> {
    let path_and_query = req
        .uri()
        .path_and_query()
        .map_or_else(|| req.uri().path(), |pq| pq.as_str());

    let mut headers = strip_hop_by_hop(req.headers());
    // Martin builds TileJSON URLs from forwarded headers; behind Traefik they
    // are already set, in dev derive them from the original request.
    if !headers.contains_key("x-forwarded-host")
        && let Some(host) = headers.get(HOST).cloned()
    {
        headers.insert(
            axum::http::HeaderName::from_static("x-forwarded-host"),
            host,
        );
    }
    if !headers.contains_key("x-forwarded-proto") {
        headers.insert(
            axum::http::HeaderName::from_static("x-forwarded-proto"),
            axum::http::HeaderValue::from_static("http"),
        );
    }
    headers.remove(HOST);

    let proxied = ctx
        .tiles
        .fetch(path_and_query, headers)
        .await
        .map_err(|e| ApiError::Busy(e.to_string()))?;

    let mut builder = Response::builder().status(proxied.status);
    if let Some(out_headers) = builder.headers_mut() {
        *out_headers = strip_hop_by_hop(&proxied.headers);
    }
    builder
        .body(proxied.body)
        .map_err(|e| ApiError::Internal(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::CONTENT_TYPE;

    #[test]
    fn martin_config_uses_loopback_and_tiles_prefix() {
        let app = AppConfig::default();
        let cfg = build_martin_config(&app);
        assert_eq!(cfg.srv.listen_addresses.as_deref(), Some("127.0.0.1:3111"));
        assert_eq!(cfg.srv.route_prefix.as_deref(), Some("/tiles"));
    }

    #[test]
    fn hop_by_hop_headers_are_stripped() {
        let mut headers = HeaderMap::new();
        headers.insert(CONNECTION, "keep-alive".parse().expect("value"));
        headers.insert(CONTENT_TYPE, "application/json".parse().expect("value"));
        let out = strip_hop_by_hop(&headers);
        assert!(!out.contains_key(CONNECTION));
        assert!(out.contains_key(CONTENT_TYPE));
    }
}
