//! Minimal Meta Model API adapter behind a small contract.
//!
//! - The key is read ONLY from the process `META_API_KEY` environment.
//! - The model is chosen with `META_MODEL` (default `muse-spark-1.3`).
//! - The key is never logged, serialized or sent to the frontend.
//!
//! This crate does not depend on Tauri or React: pure domain + adapter.

pub mod code;
pub mod design;
pub mod error;
pub mod generation;
pub mod mockup;
pub mod protocol;

use std::fmt;
use std::time::Duration;

use serde::Serialize;

use crate::error::redact;
use crate::protocol::{
    build_request_body, classify_transport, parse_error, parse_success, TokenUsage, DEFAULT_MODEL,
    REQUEST_TIMEOUT_SECS, RESPONSES_URL,
};

pub use crate::error::{sanitize, truncate, MetaError, MetaErrorKind};

/// Name of the environment variable holding the Meta key.
pub const API_KEY_ENV: &str = "META_API_KEY";
/// Name of the environment variable holding the model.
pub const MODEL_ENV: &str = "META_MODEL";

/// Key that never shows in debug output or logs.
#[derive(Clone)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

/// Configuration resolved from the process environment.
/// `Debug`-safe: the key shows redacted.
#[derive(Debug)]
pub struct MetaConfig {
    pub api_key: SecretString,
    pub model: String,
}

impl MetaConfig {
    /// Reads `META_API_KEY` and `META_MODEL`. Without a key no request is
    /// possible: returns `MissingKey` before any network.
    pub fn from_env() -> Result<Self, MetaError> {
        let api_key = read_env(API_KEY_ENV)
            .filter(|v| !v.trim().is_empty())
            .map(SecretString::new)
            .ok_or_else(MetaError::missing_key)?;
        Ok(Self {
            api_key,
            model: resolve_model(),
        })
    }
}

/// Is there a non-empty key in the environment? No network; presence only.
pub fn api_key_present() -> bool {
    read_env(API_KEY_ENV).is_some_and(|v| !v.trim().is_empty())
}

/// Model chosen by `META_MODEL` or the documented default.
pub fn resolve_model() -> String {
    read_env(MODEL_ENV)
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

fn read_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// Serializable result for the frontend. No invented costs: only what
/// the API provides (text, model and token usage).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSuccess {
    pub text: String,
    pub model: String,
    pub truncated: bool,
    pub usage: Option<TokenUsage>,
}

/// Runs the minimal test: a single POST without retries.
pub async fn test_connection(config: &MetaConfig) -> Result<ConnectionSuccess, MetaError> {
    let secret = config.api_key.expose();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|err| MetaError::network(&redact(&err.to_string(), secret)))?;

    let response = client
        .post(RESPONSES_URL)
        .header("Authorization", format!("Bearer {secret}"))
        .json(&build_request_body(&config.model))
        .send()
        .await
        .map_err(|err| classify_transport(&err, secret))?;

    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .map_err(|err| classify_transport(&err, secret))?;

    if (200..300).contains(&status) {
        let parsed = parse_success(status, &body, secret)?;
        Ok(ConnectionSuccess {
            text: parsed.text,
            model: parsed.model,
            truncated: parsed.truncated,
            usage: parsed.usage,
        })
    } else {
        Err(parse_error(status, &body, retry_after.as_deref(), secret))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only test touching the environment: it sets up, checks and restores
    // in sequence within itself to avoid interfering with other tests.
    #[test]
    fn env_config_reports_missing_key_and_honors_model() {
        let saved_key = std::env::var(API_KEY_ENV).ok();
        let saved_model = std::env::var(MODEL_ENV).ok();

        std::env::remove_var(API_KEY_ENV);
        std::env::remove_var(MODEL_ENV);
        assert!(!api_key_present());
        assert_eq!(resolve_model(), DEFAULT_MODEL);
        let err = MetaConfig::from_env().expect_err("no key means no config");
        assert_eq!(err.kind, MetaErrorKind::MissingKey);

        std::env::set_var(API_KEY_ENV, "  ");
        assert!(!api_key_present());
        assert!(MetaConfig::from_env().is_err());

        std::env::set_var(API_KEY_ENV, "sk-test");
        std::env::set_var(MODEL_ENV, "other-model");
        assert!(api_key_present());
        let config = MetaConfig::from_env().expect("key means config");
        assert_eq!(config.api_key.expose(), "sk-test");
        assert_eq!(config.model, "other-model");

        // Restore the previous environment.
        match saved_key {
            Some(v) => std::env::set_var(API_KEY_ENV, v),
            None => std::env::remove_var(API_KEY_ENV),
        }
        match saved_model {
            Some(v) => std::env::set_var(MODEL_ENV, v),
            None => std::env::remove_var(MODEL_ENV),
        }
    }

    #[test]
    fn secret_is_never_debug_printed() {
        let secret = SecretString::new("sk-test".to_string());
        assert_eq!(format!("{secret:?}"), "[redacted]");
    }

    #[test]
    fn success_serializes_shape_for_frontend() {
        let ok = ConnectionSuccess {
            text: "Ruth IDE listo".to_string(),
            model: DEFAULT_MODEL.to_string(),
            truncated: false,
            usage: Some(TokenUsage {
                input_tokens: 18,
                output_tokens: 42,
                total_tokens: 60,
            }),
        };
        let json = serde_json::to_value(&ok).expect("serializable");
        assert_eq!(json["text"], "Ruth IDE listo");
        assert_eq!(json["truncated"], false);
        assert_eq!(json["usage"]["inputTokens"], 18);
        assert_eq!(json["usage"]["totalTokens"], 60);
    }
}
