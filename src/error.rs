use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// API error type mapped onto HTTP status codes with a JSON body.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("export too large: estimated {estimated_tiles} tiles exceeds the limit of {max_tiles}")]
    TooLarge {
        estimated_tiles: u64,
        max_tiles: u64,
    },
    #[error("{0}")]
    RateLimited(String),
    #[error("{0}")]
    Busy(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Gone(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ErrorBody {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_tiles: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tiles: Option<u64>,
}

impl ApiError {
    fn status(&self) -> StatusCode {
        match self {
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Validation(_) => StatusCode::BAD_REQUEST,
            Self::TooLarge { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            Self::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::Busy(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Gone(_) => StatusCode::GONE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if matches!(self, Self::Internal(_)) {
            tracing::error!(error = %self, "internal error");
        }
        let (estimated_tiles, max_tiles) = match &self {
            Self::TooLarge {
                estimated_tiles,
                max_tiles,
            } => (Some(*estimated_tiles), Some(*max_tiles)),
            _ => (None, None),
        };
        let body = ErrorBody {
            error: self.to_string(),
            estimated_tiles,
            max_tiles,
        };
        (self.status(), Json(body)).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self::Internal(format!("database error: {e}"))
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        Self::Internal(format!("io error: {e}"))
    }
}
