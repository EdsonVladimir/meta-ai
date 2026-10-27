//! Generación asistida de requisitos (hito 5).
//!
//! Modalidad verificada en la documentación oficial
//! (`https://dev.meta.ai/docs/structured-output`): la Responses API expone la
//! salida estructurada con el parámetro `text.format` (`type: "json_schema"`;
//! `response_format` es el equivalente de Chat Completions y no configura
//! nada aquí). El esquema guía al modelo, pero la validación autoritativa es
//! siempre este módulo: campos, tipos, contenido no vacío, identificadores
//! temporales únicos y límites. Lo que no valide se rechaza sin crear nada.
//!
//! Todo es puro salvo `generate` (una petición, sin reintentos): se verifica
//! con fixtures, sin consumo real.

use std::time::Duration;

use crate::error::{redact, MetaError, MetaErrorKind};
use crate::protocol::{classify_transport, parse_error, parse_success_capped, TokenUsage};

/// Versión de la plantilla de instrucciones. Cada generación la registra para
/// poder reproducir y auditar qué se le pidió al modelo.
pub const TEMPLATE_VERSION: u32 = 1;
/// Máximo de propuestas y preguntas por generación (pedido al modelo y
/// exigido al validar).
pub const MAX_PROPOSALS: usize = 8;
pub const MAX_QUESTIONS: usize = 5;
/// Límites de entrada: descripción, requisitos de contexto y total.
pub const MAX_DESCRIPTION_CHARS: usize = 4000;
pub const MAX_CONTEXT_ITEMS: usize = 20;
pub const MAX_CONTEXT_CONTENT_CHARS: usize = 2000;
pub const MAX_INPUT_CHARS: usize = 50_000;
/// Límites de salida por campo.
pub const MAX_TEMP_ID_CHARS: usize = 64;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_PROPOSAL_CHARS: usize = 4000;
pub const MAX_ACCEPTANCE_ITEMS: usize = 10;
pub const MAX_ASSUMPTION_ITEMS: usize = 10;
pub const MAX_ITEM_CHARS: usize = 1000;
/// Límite de salida: cubre razonamiento + JSON juntos (hasta 8 propuestas).
pub const GENERATION_MAX_OUTPUT_TOKENS: u32 = 4096;
/// Generar tarda más que la prueba mínima: timeout propio, sin reintentos.
pub const GENERATION_TIMEOUT_SECS: u64 = 90;
/// Tope del cuerpo HTTP aceptado (la salida útil es mucho menor).
pub const MAX_BODY_BYTES: usize = 262_144;

/// Requisito del módulo activo usado como contexto: versión exacta actual y
/// su contenido. Solo estos datos (más la descripción) viajan a Meta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerationContextItem {
    pub artifact_id: String,
    pub version_id: String,
    pub content: String,
}

/// Propuesta validada, lista para registrar. El `temp_id` es temporal del
/// modelo: al aceptar se crean identificadores definitivos en la app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposalDraft {
    pub temp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
}

/// Resultado validado de una generación: propuestas más preguntas abiertas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedGeneration {
    pub proposals: Vec<ProposalDraft>,
    pub questions: Vec<String>,
}

/// Resultado completo con metadatos de la llamada (modelo y uso, si los da).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerationResult {
    pub proposals: Vec<ProposalDraft>,
    pub questions: Vec<String>,
    pub model: String,
    pub usage: Option<TokenUsage>,
}

const INSTRUCTION: &str = "Eres un analista que propone requisitos para un módulo de software. \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Propón como máximo 8 requisitos y 5 preguntas abiertas. \
Cada propuesta necesita: temp_id (corto, único, solo letras, dígitos, guion y subrayado), \
title, description, acceptance (al menos un criterio) y assumptions (lista, vacía si no hay). \
Señala ambigüedades en questions y no inventes decisiones como aprobadas: \
lo que no sepas, déjalo en assumptions o questions, nunca como hecho.";

const NO_CONTEXT: &str = "(El módulo aún no tiene requisitos; propón desde la descripción.)";

/// Monta el texto enviado al modelo. Aplica los topes de entrada de forma
/// determinista: descripción recortada, como mucho 20 requisitos (los
/// primeros por identificador) con 2000 caracteres cada uno, y total máximo
/// descartando contexto sobrante por la cola (la descripción nunca se pierde).
pub fn build_generation_input(description: &str, context: &[GenerationContextItem]) -> String {
    let description = truncate_chars(description.trim(), MAX_DESCRIPTION_CHARS);
    let mut items: Vec<GenerationContextItem> = context.to_vec();
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    items.truncate(MAX_CONTEXT_ITEMS);
    let mut rendered: Vec<String> = items
        .iter()
        .map(|item| {
            format!(
                "[{} @ {}]\n{}",
                item.artifact_id,
                item.version_id,
                truncate_chars(item.content.trim(), MAX_CONTEXT_CONTENT_CHARS)
            )
        })
        .collect();
    loop {
        let input = assemble(&description, &rendered);
        if input.chars().count() <= MAX_INPUT_CHARS || rendered.is_empty() {
            return input;
        }
        rendered.pop();
    }
}

fn assemble(description: &str, rendered: &[String]) -> String {
    let context = if rendered.is_empty() {
        NO_CONTEXT.to_string()
    } else {
        format!(
            "Requisitos actuales del módulo (contexto; {}):\n{}",
            rendered.len(),
            rendered.join("\n\n")
        )
    };
    format!("{INSTRUCTION}\n\nDescripción del módulo:\n{description}\n\n{context}")
}

/// Esquema JSON enviado en `text.format`. Fija forma y topes de cantidad; los
/// topes de longitud y la unicidad se exigen al validar en Rust.
pub fn generation_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "proposals": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_PROPOSALS,
                "items": {
                    "type": "object",
                    "properties": {
                        "temp_id": { "type": "string" },
                        "title": { "type": "string" },
                        "description": { "type": "string" },
                        "acceptance": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": MAX_ACCEPTANCE_ITEMS,
                            "items": { "type": "string" }
                        },
                        "assumptions": {
                            "type": "array",
                            "maxItems": MAX_ASSUMPTION_ITEMS,
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["temp_id", "title", "description", "acceptance", "assumptions"],
                    "additionalProperties": false
                }
            },
            "questions": {
                "type": "array",
                "maxItems": MAX_QUESTIONS,
                "items": { "type": "string" }
            }
        },
        "required": ["proposals", "questions"],
        "additionalProperties": false
    })
}

/// Cuerpo de la petición de generación: como la prueba mínima más el
/// `text.format` con el esquema JSON documentado para Responses API.
pub fn build_generation_body(model: &str, input: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "input": input,
        "max_output_tokens": GENERATION_MAX_OUTPUT_TOKENS,
        "reasoning": { "effort": "minimal" },
        "store": false,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "requirement_proposals",
                "schema": generation_json_schema(),
            }
        },
    })
}

/// Valida el texto del modelo como resultado estructurado. Rechaza sin crear
/// nada ante: JSON ausente (`InvalidResponse`), cero propuestas
/// (`Incomplete`, salida incompleta) o cualquier campo inválido o fuera de
/// límites (`InvalidResponse`).
pub fn parse_generation_output(text: &str) -> Result<ValidatedGeneration, MetaError> {
    let json = extract_json(text).ok_or_else(|| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "La API devolvió una generación que no es JSON válido.",
            false,
        )
    })?;
    let proposals = json
        .get("proposals")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("falta la lista de propuestas"))?;
    if proposals.is_empty() {
        return Err(MetaError::new(
            MetaErrorKind::Incomplete,
            "La API devolvió una generación sin propuestas.",
            false,
        ));
    }
    if proposals.len() > MAX_PROPOSALS {
        return Err(invalid(format!(
            "demasiadas propuestas: {} (máximo {MAX_PROPOSALS})",
            proposals.len()
        )));
    }
    let questions = json
        .get("questions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("falta la lista de preguntas"))?;
    if questions.len() > MAX_QUESTIONS {
        return Err(invalid(format!(
            "demasiadas preguntas: {} (máximo {MAX_QUESTIONS})",
            questions.len()
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(proposals.len());
    for (i, proposal) in proposals.iter().enumerate() {
        let n = i + 1;
        let temp_id = field(proposal, "temp_id", n)?;
        if !valid_temp_id(&temp_id) {
            return Err(invalid(format!(
                "propuesta {n}: identificador temporal inválido"
            )));
        }
        if !seen.insert(temp_id.clone()) {
            return Err(invalid(format!(
                "propuesta {n}: identificador temporal duplicado"
            )));
        }
        let title = non_empty(&field(proposal, "title", n)?, MAX_TITLE_CHARS)
            .ok_or_else(|| invalid(format!("propuesta {n}: título vacío o excesivo")))?;
        let description = non_empty(&field(proposal, "description", n)?, MAX_PROPOSAL_CHARS)
            .ok_or_else(|| invalid(format!("propuesta {n}: descripción vacía o excesiva")))?;
        let acceptance = items(proposal, "acceptance", n, 1, MAX_ACCEPTANCE_ITEMS)?;
        let assumptions = items(proposal, "assumptions", n, 0, MAX_ASSUMPTION_ITEMS)?;
        out.push(ProposalDraft {
            temp_id,
            title,
            description,
            acceptance,
            assumptions,
        });
    }
    let mut qs = Vec::with_capacity(questions.len());
    for (i, question) in questions.iter().enumerate() {
        let text = question
            .as_str()
            .ok_or_else(|| invalid(format!("pregunta {}: no es texto", i + 1)))?;
        let text = non_empty(text, MAX_ITEM_CHARS)
            .ok_or_else(|| invalid(format!("pregunta {}: vacía o excesiva", i + 1)))?;
        qs.push(text);
    }
    Ok(ValidatedGeneration {
        proposals: out,
        questions: qs,
    })
}

/// Ejecuta una generación: un único POST sin reintentos, con timeout propio y
/// tope de cuerpo. Reutiliza la clasificación de transporte y errores de la
/// prueba de conexión.
pub async fn generate(
    config: &crate::MetaConfig,
    input: &str,
) -> Result<GenerationResult, MetaError> {
    let secret = config.api_key.expose();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(GENERATION_TIMEOUT_SECS))
        .build()
        .map_err(|err| MetaError::network(&redact(&err.to_string(), secret)))?;

    let response = client
        .post(crate::protocol::RESPONSES_URL)
        .header("Authorization", format!("Bearer {secret}"))
        .json(&build_generation_body(&config.model, input))
        .send()
        .await
        .map_err(|err| classify_transport(&err, secret))?;

    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|err| classify_transport(&err, secret))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err(MetaError::new(
            MetaErrorKind::InvalidResponse,
            "La API devolvió una respuesta que excede el tamaño máximo.",
            false,
        )
        .with_status(status));
    }
    let body = String::from_utf8(bytes.to_vec()).map_err(|_| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "La API devolvió una respuesta que no es texto válido.",
            false,
        )
        .with_status(status)
    })?;

    if !(200..300).contains(&status) {
        return Err(parse_error(status, &body, retry_after.as_deref(), secret));
    }
    // El JSON útil cabe de sobra bajo el tope del cuerpo HTTP.
    let parsed = parse_success_capped(status, &body, secret, MAX_BODY_BYTES)?;
    let validated = parse_generation_output(&parsed.text).map_err(|err| err.with_status(status))?;
    Ok(GenerationResult {
        proposals: validated.proposals,
        questions: validated.questions,
        model: parsed.model,
        usage: parsed.usage,
    })
}

fn invalid(message: impl Into<String>) -> MetaError {
    MetaError::new(MetaErrorKind::InvalidResponse, message.into(), false)
}

/// Extrae el objeto JSON: texto directo, bloque cercado o el tramo entre la
/// primera `{` y la última `}`. Si nada parsea, no hay JSON utilizable.
pub(crate) fn extract_json(text: &str) -> Option<serde_json::Value> {
    if let Ok(json) = serde_json::from_str(text.trim()) {
        return Some(json);
    }
    if let Some(fenced) = extract_fenced(text) {
        if let Ok(json) = serde_json::from_str(fenced.trim()) {
            return Some(json);
        }
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&text[start..=end]).ok()
}

fn extract_fenced(text: &str) -> Option<&str> {
    let start = text.find("```")?;
    let after = &text[start + 3..];
    let body = after.find('\n').map(|i| &after[i + 1..]).unwrap_or(after);
    let end = body.find("```")?;
    Some(&body[..end])
}

fn field(proposal: &serde_json::Value, name: &str, n: usize) -> Result<String, MetaError> {
    proposal
        .get(name)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| invalid(format!("propuesta {n}: falta {name} o no es texto")))
}

fn non_empty(text: &str, max_chars: usize) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max_chars {
        return None;
    }
    Some(trimmed.to_string())
}

fn items(
    proposal: &serde_json::Value,
    name: &str,
    n: usize,
    min: usize,
    max: usize,
) -> Result<Vec<String>, MetaError> {
    let values = proposal
        .get(name)
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid(format!("propuesta {n}: falta {name} o no es lista")))?;
    if values.len() < min || values.len() > max {
        return Err(invalid(format!(
            "propuesta {n}: {name} debe tener entre {min} y {max} elementos",
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for (i, value) in values.iter().enumerate() {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("propuesta {n}: {name}[{}] no es texto", i + 1)))?;
        let text = non_empty(text, MAX_ITEM_CHARS)
            .ok_or_else(|| invalid(format!("propuesta {n}: {name}[{}] vacío o excesivo", i + 1)))?;
        out.push(text);
    }
    Ok(out)
}

fn valid_temp_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && id.chars().count() <= MAX_TEMP_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let end = text
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    format!("{}…", text[..end].trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "sk-prueba";

    fn item(id: &str, content: &str) -> GenerationContextItem {
        GenerationContextItem {
            artifact_id: id.to_string(),
            version_id: format!("{id}-v1"),
            content: content.to_string(),
        }
    }

    #[test]
    fn generation_body_uses_text_format_with_schema() {
        let body = build_generation_body("muse-spark-1.3", "entrada");
        assert_eq!(body["model"], "muse-spark-1.3");
        assert_eq!(body["max_output_tokens"], GENERATION_MAX_OUTPUT_TOKENS);
        assert_eq!(body["store"], false);
        let format = &body["text"]["format"];
        assert_eq!(format["type"], "json_schema");
        assert_eq!(format["name"], "requirement_proposals");
        let schema = &format["schema"];
        assert_eq!(
            schema["required"],
            serde_json::json!(["proposals", "questions"])
        );
        assert_eq!(schema["properties"]["proposals"]["maxItems"], MAX_PROPOSALS);
        assert_eq!(schema["properties"]["questions"]["maxItems"], MAX_QUESTIONS);
        // Sin recursión: la documentación rechaza esquemas recursivos (400).
        assert!(format.to_string().chars().count() < 100_000);
    }

    #[test]
    fn input_renders_description_and_context() {
        let input = build_generation_input(
            "Ventas con control de stock.",
            &[item("req-1", "Confirmar descuenta stock.")],
        );
        assert!(input.contains("Ventas con control de stock."));
        assert!(input.contains("[req-1 @ req-1-v1]"));
        assert!(input.contains("Confirmar descuenta stock."));
        assert!(input.contains("no inventes decisiones como aprobadas"));
    }

    #[test]
    fn input_without_context_says_so() {
        let input = build_generation_input("Módulo nuevo.", &[]);
        assert!(input.contains("aún no tiene requisitos"));
    }

    #[test]
    fn input_applies_entry_caps_deterministically() {
        let long = "x".repeat(MAX_DESCRIPTION_CHARS + 100);
        let mut context = Vec::new();
        for i in 0..30 {
            context.push(item(&format!("req-{i:02}"), &"y".repeat(3000)));
        }
        let input = build_generation_input(&long, &context);
        assert!(input.chars().count() <= MAX_INPUT_CHARS);
        // Los 20 primeros por identificador entran; el resto no.
        assert!(input.contains("[req-00 @ req-00-v1]"));
        assert!(input.contains("[req-19 @ req-19-v1]"));
        assert!(!input.contains("[req-20 @ req-20-v1]"));
        // El contenido largo se recorta y la descripción sobrevive.
        assert!(!input.contains(&"y".repeat(3000)));
        assert!(input.contains(&"x".repeat(100)));
    }

    #[test]
    fn parses_valid_generation_fixture() {
        let body = include_str!("../tests/fixtures/generation_completed.json");
        let parsed = parse_success_capped(200, body, SECRET, MAX_BODY_BYTES).expect("envolvente");
        assert!(!parsed.truncated);
        let validated = parse_generation_output(&parsed.text).expect("válida");
        assert_eq!(validated.proposals.len(), 2);
        assert_eq!(validated.proposals[0].temp_id, "p1");
        assert_eq!(
            validated.proposals[0].title,
            "Confirmar venta descuenta stock"
        );
        assert_eq!(validated.proposals[0].acceptance.len(), 2);
        assert_eq!(validated.proposals[1].assumptions.len(), 0);
        assert_eq!(validated.questions.len(), 1);
        let usage = parsed.usage.expect("uso");
        assert_eq!(usage.total_tokens, 1200);
    }

    #[test]
    fn accepts_fenced_json_as_fallback() {
        let text = "Claro, aquí tienes:\n```json\n{\"proposals\": [{\"temp_id\": \"a\", \
            \"title\": \"T\", \"description\": \"D\", \"acceptance\": [\"C\"], \
            \"assumptions\": []}], \"questions\": []}\n```";
        let validated = parse_generation_output(text).expect("cercado");
        assert_eq!(validated.proposals.len(), 1);
        assert!(validated.questions.is_empty());
    }

    #[test]
    fn non_json_is_invalid() {
        let err = parse_generation_output("solo prosa, sin objeto").expect_err("inválida");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        assert!(!err.retryable);
    }

    #[test]
    fn empty_proposals_is_incomplete() {
        let err = parse_generation_output(r#"{"proposals": [], "questions": ["q"]}"#)
            .expect_err("incompleta");
        assert_eq!(err.kind, MetaErrorKind::Incomplete);
    }

    #[test]
    fn over_limits_is_invalid() {
        let many: Vec<_> = (0..9)
            .map(|i| {
                format!(
                    "{{\"temp_id\": \"p{i}\", \"title\": \"T\", \"description\": \"D\", \
                     \"acceptance\": [\"C\"], \"assumptions\": []}}"
                )
            })
            .collect();
        let err = parse_generation_output(&format!(
            "{{\"proposals\": [{}], \"questions\": []}}",
            many.join(",")
        ))
        .expect_err("9 propuestas");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        assert!(err.message.contains('9'));

        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "T", "description": "D",
               "acceptance": ["C"], "assumptions": []}],
               "questions": ["1", "2", "3", "4", "5", "6"]}"#,
        )
        .expect_err("6 preguntas");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
    }

    #[test]
    fn duplicate_or_bad_temp_ids_are_invalid() {
        let dup = r#"{"proposals": [
            {"temp_id": "x", "title": "T", "description": "D",
             "acceptance": ["C"], "assumptions": []},
            {"temp_id": "x", "title": "T", "description": "D",
             "acceptance": ["C"], "assumptions": []}],
            "questions": []}"#;
        let err = parse_generation_output(dup).expect_err("duplicado");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        assert!(err.message.contains("duplicado"));

        let bad = r#"{"proposals": [
            {"temp_id": "con espacios", "title": "T", "description": "D",
             "acceptance": ["C"], "assumptions": []}],
            "questions": []}"#;
        let err = parse_generation_output(bad).expect_err("caracteres");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
    }

    #[test]
    fn empty_fields_missing_lists_and_bad_items_are_invalid() {
        // Título vacío.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "  ", "description": "D",
               "acceptance": ["C"], "assumptions": []}], "questions": []}"#,
        )
        .expect_err("título vacío");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Sin criterios de aceptación.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "T", "description": "D",
               "acceptance": [], "assumptions": []}], "questions": []}"#,
        )
        .expect_err("sin criterios");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Campo que no es texto.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": 42, "description": "D",
               "acceptance": ["C"], "assumptions": []}], "questions": []}"#,
        )
        .expect_err("título numérico");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Pregunta vacía.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "T", "description": "D",
               "acceptance": ["C"], "assumptions": []}], "questions": ["  "]}"#,
        )
        .expect_err("pregunta vacía");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Campo demasiado largo.
        let long = "z".repeat(MAX_TITLE_CHARS + 1);
        let err = parse_generation_output(&format!(
            "{{\"proposals\": [{{\"temp_id\": \"a\", \"title\": \"{long}\",
              \"description\": \"D\", \"acceptance\": [\"C\"], \"assumptions\": []}}],
              \"questions\": []}}"
        ))
        .expect_err("título largo");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
    }
}
