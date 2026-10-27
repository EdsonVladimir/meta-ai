//! Protocolo de Meta Model API (Responses API) para la prueba mínima.
//!
//! Valores comprobados en la documentación oficial (`https://dev.meta.ai/docs`):
//! endpoint `POST /v1/responses`, modelo `muse-spark-1.3`, cuerpo con
//! `model` + `input`, `max_output_tokens` con mínimo 16 y envolvente de
//! error `{ "error": { "message", "type", "code", ... } }`.
//!
//! Todo es puro (sin red): se verifica con fixtures, sin consumo real.

use serde::Serialize;

use crate::error::{redact, sanitize, truncate, MetaError, MetaErrorKind};

/// Base oficial de Meta Model API (ver quickstart en dev.meta.ai/docs).
pub const RESPONSES_URL: &str = "https://api.meta.ai/v1/responses";
/// Modelo por defecto: el recomendado en la documentación para trabajo nuevo.
pub const DEFAULT_MODEL: &str = "muse-spark-1.3";
/// Petición exacta de la prueba mínima.
pub const PROMPT: &str = "Responde solo: Ruth IDE listo";
/// Límite de salida: cubre razonamiento + texto visible juntos (ver
/// `dev.meta.ai/docs/reasoning`). 256 da margen al razonamiento mínimo sin
/// dejar de ser una prueba diminuta (mínimo documentado: 16).
pub const MAX_OUTPUT_TOKENS: u32 = 256;
/// Tiempo máximo de la petición.
pub const REQUEST_TIMEOUT_SECS: u64 = 30;
/// Tope de texto devuelto al frontend (la respuesta esperada es diminuta).
const MAX_TEXT_CHARS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedResponse {
    pub text: String,
    pub model: String,
    pub truncated: bool,
    pub usage: Option<TokenUsage>,
}

/// Cuerpo de la petición de prueba. Solo contiene la frase fijada.
pub fn build_request_body(model: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "input": PROMPT,
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "reasoning": { "effort": "minimal" },
        "store": false,
    })
}

/// Interpreta una respuesta HTTP 2xx. `secret` se usa solo para redactar.
pub fn parse_success(status: u16, body: &str, secret: &str) -> Result<ParsedResponse, MetaError> {
    parse_success_capped(status, body, secret, MAX_TEXT_CHARS)
}

/// Variante con tope de texto propio: la generación estructurada necesita
/// mucho más que los 500 caracteres de la prueba mínima.
pub fn parse_success_capped(
    status: u16,
    body: &str,
    secret: &str,
    max_chars: usize,
) -> Result<ParsedResponse, MetaError> {
    if !(200..300).contains(&status) {
        return Err(MetaError::new(
            MetaErrorKind::InvalidResponse,
            format!("La API devolvió un estado inesperado: HTTP {status}."),
            false,
        )
        .with_status(status));
    }
    let json: serde_json::Value = serde_json::from_str(body).map_err(|_| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "La API devolvió una respuesta que no es JSON válido.",
            false,
        )
        .with_status(status)
    })?;

    let api_status = json.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if matches!(api_status, "failed" | "cancelled") {
        return Err(MetaError::new(
            MetaErrorKind::InvalidResponse,
            format!("La API no completó la respuesta (estado: {api_status})."),
            false,
        )
        .with_status(status));
    }

    let text = extract_output_text(&json)
        .map(|t| truncate(&redact(&t, secret), max_chars))
        .unwrap_or_default();
    if !text.is_empty() {
        let model = json
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_MODEL)
            .to_string();
        return Ok(ParsedResponse {
            text,
            model,
            truncated: api_status != "completed",
            usage: extract_usage(&json),
        });
    }

    // Sin texto visible: distinguir rechazo, incompleta y formato inesperado.
    if let Some(refusal) = extract_refusal(&json, secret) {
        return Err(MetaError::new(MetaErrorKind::Refusal, refusal, false).with_status(status));
    }
    if api_status == "incomplete" {
        return Err(incomplete_error(&json, status));
    }
    Err(MetaError::new(
        MetaErrorKind::InvalidResponse,
        "La API devolvió una respuesta sin texto utilizable.",
        false,
    )
    .with_status(status))
}

/// Rechazo del modelo: parte `refusal` dentro de un mensaje. Solo metadatos
/// seguros: el texto del rechazo, saneado y redactado.
fn extract_refusal(json: &serde_json::Value, secret: &str) -> Option<String> {
    let output = json.get("output")?.as_array()?;
    for item in output {
        if item.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        let content = item.get("content")?.as_array()?;
        for part in content {
            if part.get("type").and_then(|v| v.as_str()) == Some("refusal") {
                let text = part
                    .get("refusal")
                    .and_then(|v| v.as_str())
                    .map(|t| sanitize(redact(t, secret)))
                    .filter(|t| !t.is_empty());
                return Some(match text {
                    Some(t) => format!("El modelo rechazó responder: {t}"),
                    None => "El modelo rechazó responder.".to_string(),
                });
            }
        }
    }
    None
}

/// Respuesta `incomplete` sin texto visible. Usa `incomplete_details.reason`
/// y los tokens de salida: nunca el cuerpo completo.
fn incomplete_error(json: &serde_json::Value, status: u16) -> MetaError {
    let reason = json
        .get("incomplete_details")
        .and_then(|d| d.get("reason"))
        .and_then(|r| r.as_str());
    let message = match reason {
        Some("max_output_tokens") => {
            let used = output_tokens_used(json)
                .map(|n| format!("salida: {n}"))
                .unwrap_or_else(|| "salida desconocida".to_string());
            format!(
                "La API no completó la respuesta: se agotó el límite de salida de la prueba \
                 ({MAX_OUTPUT_TOKENS} tokens; {used}) antes de producir texto visible. \
                 La conexión funciona."
            )
        }
        Some("content_filter") => {
            "La API detuvo la respuesta por el filtro de contenido antes de producir texto visible."
                .to_string()
        }
        Some(other) => format!("La API no completó la respuesta (motivo: {other})."),
        None => "La API no completó la respuesta (estado: incomplete).".to_string(),
    };
    MetaError::new(MetaErrorKind::Incomplete, message, false).with_status(status)
}

fn output_tokens_used(json: &serde_json::Value) -> Option<u64> {
    json.get("usage")?.get("output_tokens")?.as_u64()
}

/// Extrae el texto visible: recorre `output[]` buscando partes `output_text`
/// y acepta además un `output_text` directo en la raíz.
fn extract_output_text(json: &serde_json::Value) -> Option<String> {
    if let Some(direct) = json.get("output_text").and_then(|v| v.as_str()) {
        return Some(direct.to_string());
    }
    let output = json.get("output")?.as_array()?;
    let mut parts = Vec::new();
    for item in output {
        if item.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        let content = item.get("content")?.as_array()?;
        for part in content {
            if part.get("type").and_then(|v| v.as_str()) == Some("output_text") {
                if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                    parts.push(text);
                }
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(""))
    }
}

fn extract_usage(json: &serde_json::Value) -> Option<TokenUsage> {
    let usage = json.get("usage")?;
    Some(TokenUsage {
        input_tokens: usage.get("input_tokens")?.as_u64()? as u32,
        output_tokens: usage.get("output_tokens")?.as_u64()? as u32,
        total_tokens: usage.get("total_tokens")?.as_u64()? as u32,
    })
}

/// Clasifica un estado HTTP de error según la tabla oficial de errores
/// (401 autenticación, 402 facturación, 429 rate limit, 5xx servidor...).
/// `retry_after` es el valor crudo de la cabecera `Retry-After`, si existe.
pub fn parse_error(status: u16, body: &str, retry_after: Option<&str>, secret: &str) -> MetaError {
    let detail = api_error_detail(body, secret);
    let (kind, base, retryable) = match status {
        401 => (
            MetaErrorKind::Auth,
            "La clave fue rechazada por Meta. Revisa META_API_KEY.",
            false,
        ),
        402 => (
            MetaErrorKind::Billing,
            "Meta devolvió un problema de facturación o saldo.",
            false,
        ),
        403 => (
            MetaErrorKind::Forbidden,
            "La clave no tiene permiso para este modelo o recurso.",
            false,
        ),
        404 => (
            MetaErrorKind::ModelNotFound,
            "El modelo o el recurso no existe en Meta.",
            false,
        ),
        429 => (
            MetaErrorKind::RateLimit,
            "Meta limitó el ritmo de peticiones (rate limit).",
            true,
        ),
        400 => (
            MetaErrorKind::BadRequest,
            "Meta rechazó la petición por parámetros inválidos.",
            false,
        ),
        500..=599 => (
            MetaErrorKind::Server,
            "Meta devolvió un error interno de servidor.",
            true,
        ),
        _ => (
            MetaErrorKind::Unexpected,
            "Meta devolvió un estado inesperado.",
            false,
        ),
    };
    let message = match detail {
        Some(d) => format!("{base} Detalle: {d}"),
        None => format!("{base} (HTTP {status})"),
    };
    let mut err = MetaError::new(kind, message, retryable).with_status(status);
    if kind == MetaErrorKind::RateLimit {
        if let Some(secs) = retry_after.and_then(parse_retry_after) {
            err = err.with_retry_after(secs);
        }
    }
    err
}

/// Extrae `error.message` de la envolvente oficial, saneado y redactado.
/// Devuelve `None` si el cuerpo está vacío o no es JSON (p. ej. 404 sin cuerpo).
fn api_error_detail(body: &str, secret: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    let message = json.get("error")?.get("message")?.as_str()?;
    if message.trim().is_empty() {
        return None;
    }
    Some(sanitize(redact(message, secret)))
}

fn parse_retry_after(value: &str) -> Option<u64> {
    value.trim().parse::<u64>().ok()
}

/// Clasifica un fallo de transporte de `reqwest` (sin respuesta HTTP).
pub fn classify_transport(err: &reqwest::Error, secret: &str) -> MetaError {
    if err.is_timeout() {
        return MetaError::timeout();
    }
    if err.is_connect() {
        return MetaError::network("no se pudo establecer la conexión");
    }
    MetaError::network(&sanitize(redact(&err.to_string(), secret)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "sk-prueba";

    #[test]
    fn request_body_matches_documented_shape() {
        let body = build_request_body("muse-spark-1.3");
        assert_eq!(body["model"], "muse-spark-1.3");
        assert_eq!(body["input"], PROMPT);
        assert_eq!(body["max_output_tokens"], MAX_OUTPUT_TOKENS);
        assert_eq!(body["reasoning"]["effort"], "minimal");
        assert_eq!(body["store"], false);
    }

    #[test]
    fn parses_completed_response_with_usage() {
        let body = include_str!("../tests/fixtures/success_completed.json");
        let parsed = parse_success(200, body, SECRET).expect("parse ok");
        assert_eq!(parsed.text, "Ruth IDE listo");
        assert_eq!(parsed.model, "muse-spark-1.3");
        assert!(!parsed.truncated);
        let usage = parsed.usage.expect("usage");
        assert_eq!(
            (usage.input_tokens, usage.output_tokens, usage.total_tokens),
            (18, 42, 60)
        );
    }

    #[test]
    fn incomplete_response_is_flagged_not_failed() {
        let body = include_str!("../tests/fixtures/success_incomplete.json");
        let parsed = parse_success(200, body, SECRET).expect("parse ok");
        assert_eq!(parsed.text, "Ruth IDE");
        assert!(parsed.truncated);
    }

    #[test]
    fn missing_usage_is_allowed() {
        let body = include_str!("../tests/fixtures/success_no_usage.json");
        let parsed = parse_success(200, body, SECRET).expect("parse ok");
        assert_eq!(parsed.text, "Ruth IDE listo");
        assert!(parsed.usage.is_none());
    }

    #[test]
    fn incomplete_max_tokens_reports_exhausted_budget() {
        let body = include_str!("../tests/fixtures/success_incomplete_max_tokens.json");
        let err = parse_success(200, body, SECRET).expect_err("sin texto es error");
        assert_eq!(err.kind, MetaErrorKind::Incomplete);
        assert!(!err.retryable);
        assert_eq!(err.status, Some(200));
        assert!(
            err.message.contains("límite de salida"),
            "mensaje: {}",
            err.message
        );
        assert!(
            err.message.contains(&MAX_OUTPUT_TOKENS.to_string()),
            "mensaje: {}",
            err.message
        );
    }

    #[test]
    fn incomplete_content_filter_reports_filter() {
        let body = include_str!("../tests/fixtures/success_incomplete_content_filter.json");
        let err = parse_success(200, body, SECRET).expect_err("sin texto es error");
        assert_eq!(err.kind, MetaErrorKind::Incomplete);
        assert!(!err.retryable);
        assert!(
            err.message.contains("filtro de contenido"),
            "mensaje: {}",
            err.message
        );
    }

    #[test]
    fn refusal_reports_model_refusal() {
        let body = include_str!("../tests/fixtures/success_refusal.json");
        let err = parse_success(200, body, SECRET).expect_err("rechazo es error");
        assert_eq!(err.kind, MetaErrorKind::Refusal);
        assert!(!err.retryable);
        assert_eq!(err.status, Some(200));
        assert!(err.message.contains("rechazó"), "mensaje: {}", err.message);
        assert!(
            err.message.contains("No puedo ayudar"),
            "mensaje: {}",
            err.message
        );
    }

    #[test]
    fn empty_text_is_invalid() {
        let parsed = parse_success(200, r#"{"status":"completed","output":[]}"#, SECRET);
        assert_eq!(parsed.unwrap_err().kind, MetaErrorKind::InvalidResponse);
    }

    #[test]
    fn non_json_success_is_invalid() {
        let parsed = parse_success(200, "<html>no json</html>", SECRET);
        assert_eq!(parsed.unwrap_err().kind, MetaErrorKind::InvalidResponse);
    }

    #[test]
    fn distinguishes_auth_billing_rate_limit_and_server() {
        let cases = [
            ("error_401.json", 401, MetaErrorKind::Auth, false),
            ("error_402.json", 402, MetaErrorKind::Billing, false),
            ("error_403.json", 403, MetaErrorKind::Forbidden, false),
            ("error_404.json", 404, MetaErrorKind::ModelNotFound, false),
            ("error_429.json", 429, MetaErrorKind::RateLimit, true),
            ("error_500.json", 500, MetaErrorKind::Server, true),
        ];
        for (file, status, kind, retryable) in cases {
            let path = format!("{}/tests/fixtures/{file}", env!("CARGO_MANIFEST_DIR"));
            let body = std::fs::read_to_string(&path).expect("fixture");
            let err = parse_error(status, &body, None, SECRET);
            assert_eq!(err.kind, kind, "file {file}");
            assert_eq!(err.retryable, retryable, "file {file}");
            assert_eq!(err.status, Some(status), "file {file}");
        }
    }

    #[test]
    fn empty_404_body_has_no_detail() {
        let err = parse_error(404, "", None, SECRET);
        assert_eq!(err.kind, MetaErrorKind::ModelNotFound);
        assert!(err.message.contains("HTTP 404"));
    }

    #[test]
    fn retry_after_header_is_exposed() {
        let body = include_str!("../tests/fixtures/error_429.json");
        let err = parse_error(429, body, Some("45"), SECRET);
        assert_eq!(err.retry_after_secs, Some(45));
        let err = parse_error(429, body, Some("not-a-number"), SECRET);
        assert_eq!(err.retry_after_secs, None);
    }

    #[test]
    fn api_detail_is_sanitized_and_redacted() {
        let body = format!(
            r#"{{"error":{{"message":"  fallo\ncon {SECRET} dentro  ","type":"server_error"}}}}"#
        );
        let err = parse_error(500, &body, None, SECRET);
        assert!(!err.message.contains(SECRET));
        assert!(err.message.contains("[redacted]"));
        assert!(!err.message.contains('\n'));
    }

    #[test]
    fn long_text_is_capped() {
        let long = "a".repeat(2000);
        let body = serde_json::json!({
            "status": "completed",
            "model": "muse-spark-1.3",
            "output": [{
                "type": "message",
                "content": [{"type": "output_text", "text": long}]
            }]
        })
        .to_string();
        let parsed = parse_success(200, &body, SECRET).expect("parse ok");
        assert!(parsed.text.chars().count() <= MAX_TEXT_CHARS + 1);
    }
}
