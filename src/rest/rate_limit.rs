use std::net::{IpAddr, SocketAddr};

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;
use axum::http::{HeaderMap, Request};
use tower_governor::GovernorError;
use tower_governor::key_extractor::KeyExtractor;

const CF_CONNECTING_IP: &str = "cf-connecting-ip";

/// Client IP for quota accounting: Cloudflare's header is trustworthy because
/// the origin only accepts traffic from Cloudflare; otherwise the peer address.
pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<IpAddr> {
    headers
        .get(CF_CONNECTING_IP)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<IpAddr>().ok())
        .or_else(|| peer.map(|p| p.ip()))
}

/// Axum extractor exposing the client IP (never rejects; None when neither a
/// Cloudflare header nor peer address is available).
pub struct ClientIp(pub Option<IpAddr>);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let peer = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| *addr);
        Ok(Self(client_ip(&parts.headers, peer)))
    }
}

/// tower-governor key extractor with the same semantics as [`client_ip`].
#[derive(Clone, Copy)]
pub struct CfIpKeyExtractor;

impl KeyExtractor for CfIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<Self::Key, GovernorError> {
        let peer = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| *addr);
        client_ip(req.headers(), peer).ok_or(GovernorError::UnableToExtractKey)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_cloudflare_header() {
        let mut headers = HeaderMap::new();
        headers.insert(CF_CONNECTING_IP, "203.0.113.9".parse().expect("value"));
        let peer: SocketAddr = "10.0.0.1:1234".parse().expect("addr");
        assert_eq!(
            client_ip(&headers, Some(peer)),
            Some("203.0.113.9".parse().expect("ip"))
        );
    }

    #[test]
    fn falls_back_to_peer() {
        let peer: SocketAddr = "10.0.0.1:1234".parse().expect("addr");
        assert_eq!(
            client_ip(&HeaderMap::new(), Some(peer)),
            Some("10.0.0.1".parse().expect("ip"))
        );
    }

    #[test]
    fn garbage_header_falls_back() {
        let mut headers = HeaderMap::new();
        headers.insert(CF_CONNECTING_IP, "not-an-ip".parse().expect("value"));
        let peer: SocketAddr = "10.0.0.1:1234".parse().expect("addr");
        assert_eq!(
            client_ip(&headers, Some(peer)),
            Some("10.0.0.1".parse().expect("ip"))
        );
    }

    #[test]
    fn none_when_nothing_available() {
        assert_eq!(client_ip(&HeaderMap::new(), None), None);
    }
}
