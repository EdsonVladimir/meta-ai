//! Typed errors of the Meta adapter.
//!
//! The `kind` distinguishes the cases the UI must treat differently
//! (authentication, billing, rate limit, network...). Messages are short,
//! in English and never contain the key: all external text is sanitized
//! and truncated before exposure.

use serde::Serialize;

/// Stable failure classification. Must match the frontend `MetaErrorKind`
/// (`src/features/connection/types.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MetaErrorKind {
    MissingKey,
    Busy,
    Auth,
    Billing,
    Forbidden,
    RateLimit,
    ModelNotFound,
    BadRequest,
    Server,
    Network,
    Timeout,
    Incomplete,
    Refusal,
    InvalidResponse,
    Unexpected,
}

/// Error serializable to the frontend via a Tauri command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaError {
    pub kind: MetaErrorKind,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

/// Maximum length of any external text (API messages).
const MAX_MESSAGE_CHARS: usize = 280;

impl MetaError {
    pub fn new(kind: MetaErrorKind, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            kind,
            message: sanitize(message.into()),
            retryable,
            retry_after_secs: None,
            status: None,
        }
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }

    pub fn with_retry_after(mut self, secs: u64) -> Self {
        self.retry_after_secs = Some(secs);
        self
    }

    pub fn missing_key() -> Self {
        Self::new(
            MetaErrorKind::MissingKey,
            "META_API_KEY is not set in the process environment. Set it and \
             press Test connection. No request was made.",
            false,
        )
    }

    pub fn busy() -> Self {
        Self::new(
            MetaErrorKind::Busy,
            "A connection test is already running. Wait for it to finish.",
            false,
        )
    }

    pub fn timeout() -> Self {
        Self::new(
            MetaErrorKind::Timeout,
            "The Meta request timed out. Check your connection and retry.",
            true,
        )
    }

    pub fn network(detail: &str) -> Self {
        let message = if detail.is_empty() {
            "Could not reach Meta: network failure.".to_string()
        } else {
            format!("Could not reach Meta: {detail}")
        };
        Self::new(MetaErrorKind::Network, message, true)
    }
}

/// Leaves the text on a single display-safe line and truncates it.
pub fn sanitize(text: String) -> String {
    let single_line: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = single_line.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate(&collapsed, MAX_MESSAGE_CHARS)
}

/// Extra guarantee: removes any accidental occurrence of the secret.
pub fn redact(text: &str, secret: &str) -> String {
    if secret.is_empty() {
        return text.to_string();
    }
    text.replace(secret, "[redacted]")
}

pub fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let end = text
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    format!("{}…", &text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_collapses_and_truncates() {
        let dirty = "  hello\n\tworld  with   spaces  ";
        assert_eq!(sanitize(dirty.to_string()), "hello world with spaces");
        let long = "x".repeat(500);
        let clean = sanitize(long);
        assert!(clean.chars().count() <= MAX_MESSAGE_CHARS + 1);
        assert!(clean.ends_with('…'));
    }

    #[test]
    fn redact_removes_secret() {
        let secret = "sk-test";
        let text = "failure with sk-test inside";
        assert_eq!(redact(text, secret), "failure with [redacted] inside");
        assert_eq!(redact(text, ""), text);
    }

    #[test]
    fn serializes_error_shape_for_frontend() {
        let err = MetaError::new(MetaErrorKind::RateLimit, "limit", true)
            .with_status(429)
            .with_retry_after(30);
        let json = serde_json::to_value(&err).expect("serializable");
        assert_eq!(json["kind"], "rate_limit");
        assert_eq!(json["retryable"], true);
        assert_eq!(json["retryAfterSecs"], 30);
        assert_eq!(json["status"], 429);
    }
}
