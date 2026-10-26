//! Errores tipados del adaptador de Meta.
//!
//! El `kind` distingue los casos que la interfaz debe tratar de forma
//! diferente (autenticación, facturación, rate limit, red...). Los mensajes
//! son breves, en español y nunca contienen la clave: todo texto externo se
//! sanea y se trunca antes de exponerse.

use serde::Serialize;

/// Clasificación estable del fallo. Debe coincidir con `MetaErrorKind` del
/// frontend (`src/features/connection/types.ts`).
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

/// Error serializable hacia el frontend vía comando Tauri.
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

/// Longitud máxima de cualquier texto externo (mensajes de la API).
const MAX_MESSAGE_CHARS: usize = 280;

impl MetaError {
    pub fn new(
        kind: MetaErrorKind,
        message: impl Into<String>,
        retryable: bool,
    ) -> Self {
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
            "META_API_KEY no está configurada en el entorno del proceso. \
             Configúrala y pulsa «Probar conexión». No se ha hecho ninguna petición.",
            false,
        )
    }

    pub fn busy() -> Self {
        Self::new(
            MetaErrorKind::Busy,
            "Ya hay una prueba de conexión en curso. Espera a que termine.",
            false,
        )
    }

    pub fn timeout() -> Self {
        Self::new(
            MetaErrorKind::Timeout,
            "La petición a Meta agotó el tiempo de espera. Revisa tu conexión y reintenta.",
            true,
        )
    }

    pub fn network(detail: &str) -> Self {
        let message = if detail.is_empty() {
            "No se pudo contactar con Meta: fallo de red.".to_string()
        } else {
            format!("No se pudo contactar con Meta: {detail}")
        };
        Self::new(MetaErrorKind::Network, message, true)
    }
}

/// Deja el texto en una sola línea segura para mostrar y lo trunca.
pub fn sanitize(text: String) -> String {
    let single_line: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = single_line.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate(&collapsed, MAX_MESSAGE_CHARS)
}

/// Garantía extra: elimina cualquier aparición accidental del secreto.
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
        let dirty = "  hola\n\tmundo  con   espacios  ";
        assert_eq!(sanitize(dirty.to_string()), "hola mundo con espacios");
        let long = "x".repeat(500);
        let clean = sanitize(long);
        assert!(clean.chars().count() <= MAX_MESSAGE_CHARS + 1);
        assert!(clean.ends_with('…'));
    }

    #[test]
    fn redact_removes_secret() {
        let secret = "sk-meta-secreto";
        let text = "fallo con sk-meta-secreto dentro";
        assert_eq!(redact(text, secret), "fallo con [redacted] dentro");
        assert_eq!(redact(text, ""), text);
    }

    #[test]
    fn serializes_error_shape_for_frontend() {
        let err = MetaError::new(MetaErrorKind::RateLimit, "límite", true)
            .with_status(429)
            .with_retry_after(30);
        let json = serde_json::to_value(&err).expect("serializable");
        assert_eq!(json["kind"], "rate_limit");
        assert_eq!(json["retryable"], true);
        assert_eq!(json["retryAfterSecs"], 30);
        assert_eq!(json["status"], 429);
    }
}
