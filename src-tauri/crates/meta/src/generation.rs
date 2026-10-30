//! Assisted requirement generation (milestone 5).
//!
//! Mode verified against the official docs
//! (`https://dev.meta.ai/docs/structured-output`): the Responses API exposes
//! structured output via the `text.format` parameter (`type: "json_schema"`;
//! `response_format` is the Chat Completions equivalent and configures
//! nothing here). The schema guides the model, but the authoritative
//! validation is always this module: fields, types, non-empty content,
//! unique temp identifiers and limits. Whatever does not validate is
//! rejected without creating anything.
//!
//! All pure except `generate` (one request, no retries): verified with
//! fixtures, no real usage.

use std::time::Duration;

use crate::error::{redact, MetaError, MetaErrorKind};
use crate::protocol::{classify_transport, parse_error, parse_success_capped, TokenUsage};

/// Instruction template version. Each generation records it so what was
/// asked of the model can be reproduced and audited. Bumped to 2 when the
/// instructions were translated to English (v1 rows keep describing the
/// original Spanish prompt).
pub const TEMPLATE_VERSION: u32 = 2;
/// Maximum proposals and questions per generation (asked of the model
/// and enforced on validation).
pub const MAX_PROPOSALS: usize = 8;
pub const MAX_QUESTIONS: usize = 5;
/// Input limits: description, context requirements and total.
pub const MAX_DESCRIPTION_CHARS: usize = 4000;
pub const MAX_CONTEXT_ITEMS: usize = 20;
pub const MAX_CONTEXT_CONTENT_CHARS: usize = 2000;
pub const MAX_INPUT_CHARS: usize = 50_000;
/// Per-field output limits.
pub const MAX_TEMP_ID_CHARS: usize = 64;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_PROPOSAL_CHARS: usize = 4000;
pub const MAX_ACCEPTANCE_ITEMS: usize = 10;
pub const MAX_ASSUMPTION_ITEMS: usize = 10;
pub const MAX_ITEM_CHARS: usize = 1000;
/// Output limit: covers reasoning + JSON together (up to 8 proposals).
pub const GENERATION_MAX_OUTPUT_TOKENS: u32 = 4096;
/// Generating takes longer than the minimal test: own timeout, no retries.
pub const GENERATION_TIMEOUT_SECS: u64 = 90;
/// Accepted HTTP body cap (the useful output is much smaller).
pub const MAX_BODY_BYTES: usize = 262_144;

/// Active-module requirement used as context: current exact version and
/// its content. Only this data (plus the description) travels to Meta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerationContextItem {
    pub artifact_id: String,
    pub version_id: String,
    pub content: String,
}

/// Validated proposal, ready to record. The `temp_id` is the model's
/// temporary one: definitive identifiers are created in the app on accept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposalDraft {
    pub temp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
}

/// Validated generation result: proposals plus open questions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedGeneration {
    pub proposals: Vec<ProposalDraft>,
    pub questions: Vec<String>,
}

/// Complete result with call metadata (model and usage, when given).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerationResult {
    pub proposals: Vec<ProposalDraft>,
    pub questions: Vec<String>,
    pub model: String,
    pub usage: Option<TokenUsage>,
}

const INSTRUCTION: &str = "You are an analyst proposing requirements for a software module. \
Reply ONLY with the requested JSON object, no extra text. \
Propose at most 8 requirements and 5 open questions. \
Each proposal needs: temp_id (short, unique, letters, digits, hyphen and underscore only), \
title, description, acceptance (at least one criterion) and assumptions (list, empty if none). \
Flag ambiguities in questions and never invent decisions as approved: \
what you do not know, leave in assumptions or questions, never as fact.";

const NO_CONTEXT: &str = "(The module has no requirements yet; propose from the description.)";

/// Builds the text sent to the model. Applies the input caps
/// deterministically: trimmed description, at most 20 requirements (the
/// first by identifier) with 2000 characters each, and a maximum total
/// dropping surplus context from the tail (the description is never lost).
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
            "Current module requirements (context; {}):\n{}",
            rendered.len(),
            rendered.join("\n\n")
        )
    };
    format!("{INSTRUCTION}\n\nModule description:\n{description}\n\n{context}")
}

/// JSON schema sent in `text.format`. Pins shape and count caps; length
/// caps and uniqueness are enforced on validation in Rust.
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

/// Generation request body: like the minimal test plus `text.format`
/// with the documented JSON schema for Responses API.
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

/// Validates the model text as a structured result. Rejects without
/// creating anything on: missing JSON (`InvalidResponse`), zero proposals
/// (`Incomplete`, incomplete output) or any invalid or out-of-limits field
/// (`InvalidResponse`).
pub fn parse_generation_output(text: &str) -> Result<ValidatedGeneration, MetaError> {
    let json = extract_json(text).ok_or_else(|| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "The API returned a generation that is not valid JSON.",
            false,
        )
    })?;
    let proposals = json
        .get("proposals")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("missing proposal list"))?;
    if proposals.is_empty() {
        return Err(MetaError::new(
            MetaErrorKind::Incomplete,
            "The API returned a generation without proposals.",
            false,
        ));
    }
    if proposals.len() > MAX_PROPOSALS {
        return Err(invalid(format!(
            "too many proposals: {} (max {MAX_PROPOSALS})",
            proposals.len()
        )));
    }
    let questions = json
        .get("questions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("missing question list"))?;
    if questions.len() > MAX_QUESTIONS {
        return Err(invalid(format!(
            "too many questions: {} (max {MAX_QUESTIONS})",
            questions.len()
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(proposals.len());
    for (i, proposal) in proposals.iter().enumerate() {
        let n = i + 1;
        let temp_id = field(proposal, "temp_id", n)?;
        if !valid_temp_id(&temp_id) {
            return Err(invalid(format!("proposal {n}: invalid temp identifier")));
        }
        if !seen.insert(temp_id.clone()) {
            return Err(invalid(format!("proposal {n}: duplicate temp identifier")));
        }
        let title = non_empty(&field(proposal, "title", n)?, MAX_TITLE_CHARS)
            .ok_or_else(|| invalid(format!("proposal {n}: empty or oversized title")))?;
        let description = non_empty(&field(proposal, "description", n)?, MAX_PROPOSAL_CHARS)
            .ok_or_else(|| invalid(format!("proposal {n}: empty or oversized description")))?;
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
            .ok_or_else(|| invalid(format!("question {}: not text", i + 1)))?;
        let text = non_empty(text, MAX_ITEM_CHARS)
            .ok_or_else(|| invalid(format!("question {}: empty or oversized", i + 1)))?;
        qs.push(text);
    }
    Ok(ValidatedGeneration {
        proposals: out,
        questions: qs,
    })
}

/// Runs a generation: a single POST without retries, with its own timeout
/// and body cap. Reuses the transport and error classification of the
/// connection test.
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
            "The API returned a response exceeding the maximum size.",
            false,
        )
        .with_status(status));
    }
    let body = String::from_utf8(bytes.to_vec()).map_err(|_| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "The API returned a response that is not valid text.",
            false,
        )
        .with_status(status)
    })?;

    if !(200..300).contains(&status) {
        return Err(parse_error(status, &body, retry_after.as_deref(), secret));
    }
    // The useful JSON fits comfortably under the HTTP body cap.
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

/// Extracts the JSON object: direct text, fenced block or the span between
/// the first `{` and the last `}`. If nothing parses, there is no usable JSON.
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
        .ok_or_else(|| invalid(format!("proposal {n}: missing {name} or not text")))
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
        .ok_or_else(|| invalid(format!("proposal {n}: missing {name} or not a list")))?;
    if values.len() < min || values.len() > max {
        return Err(invalid(format!(
            "proposal {n}: {name} must have between {min} and {max} items",
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for (i, value) in values.iter().enumerate() {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("proposal {n}: {name}[{}] is not text", i + 1)))?;
        let text = non_empty(text, MAX_ITEM_CHARS).ok_or_else(|| {
            invalid(format!(
                "proposal {n}: {name}[{}] empty or oversized",
                i + 1
            ))
        })?;
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

    const SECRET: &str = "sk-test";

    fn item(id: &str, content: &str) -> GenerationContextItem {
        GenerationContextItem {
            artifact_id: id.to_string(),
            version_id: format!("{id}-v1"),
            content: content.to_string(),
        }
    }

    #[test]
    fn generation_body_uses_text_format_with_schema() {
        let body = build_generation_body("muse-spark-1.3", "input");
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
        // No recursion: the docs reject recursive schemas (400).
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
        assert!(input.contains("never invent decisions as approved"));
    }

    #[test]
    fn input_without_context_says_so() {
        let input = build_generation_input("New module.", &[]);
        assert!(input.contains("has no requirements yet"));
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
        // The first 20 by identifier enter; the rest do not.
        assert!(input.contains("[req-00 @ req-00-v1]"));
        assert!(input.contains("[req-19 @ req-19-v1]"));
        assert!(!input.contains("[req-20 @ req-20-v1]"));
        // Long content is trimmed and the description survives.
        assert!(!input.contains(&"y".repeat(3000)));
        assert!(input.contains(&"x".repeat(100)));
    }

    #[test]
    fn parses_valid_generation_fixture() {
        let body = include_str!("../tests/fixtures/generation_completed.json");
        let parsed = parse_success_capped(200, body, SECRET, MAX_BODY_BYTES).expect("envelope");
        assert!(!parsed.truncated);
        let validated = parse_generation_output(&parsed.text).expect("valid");
        assert_eq!(validated.proposals.len(), 2);
        assert_eq!(validated.proposals[0].temp_id, "p1");
        assert_eq!(
            validated.proposals[0].title,
            "Confirming a sale discounts stock"
        );
        assert_eq!(validated.proposals[0].acceptance.len(), 2);
        assert_eq!(validated.proposals[1].assumptions.len(), 0);
        assert_eq!(validated.questions.len(), 1);
        let usage = parsed.usage.expect("usage");
        assert_eq!(usage.total_tokens, 1200);
    }

    #[test]
    fn accepts_fenced_json_as_fallback() {
        let text = "Sure, here you go:\n```json\n{\"proposals\": [{\"temp_id\": \"a\", \
            \"title\": \"T\", \"description\": \"D\", \"acceptance\": [\"C\"], \
            \"assumptions\": []}], \"questions\": []}\n```";
        let validated = parse_generation_output(text).expect("fenced");
        assert_eq!(validated.proposals.len(), 1);
        assert!(validated.questions.is_empty());
    }

    #[test]
    fn non_json_is_invalid() {
        let err = parse_generation_output("only prose, no object").expect_err("invalid");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        assert!(!err.retryable);
    }

    #[test]
    fn empty_proposals_is_incomplete() {
        let err = parse_generation_output(r#"{"proposals": [], "questions": ["q"]}"#)
            .expect_err("incomplete");
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
        .expect_err("9 proposals");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        assert!(err.message.contains('9'));

        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "T", "description": "D",
               "acceptance": ["C"], "assumptions": []}],
               "questions": ["1", "2", "3", "4", "5", "6"]}"#,
        )
        .expect_err("6 questions");
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
        let err = parse_generation_output(dup).expect_err("duplicate");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        assert!(err.message.contains("duplicate"));

        let bad = r#"{"proposals": [
            {"temp_id": "with spaces", "title": "T", "description": "D",
             "acceptance": ["C"], "assumptions": []}],
            "questions": []}"#;
        let err = parse_generation_output(bad).expect_err("characters");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
    }

    #[test]
    fn empty_fields_missing_lists_and_bad_items_are_invalid() {
        // Empty title.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "  ", "description": "D",
               "acceptance": ["C"], "assumptions": []}], "questions": []}"#,
        )
        .expect_err("empty title");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // No acceptance criteria.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "T", "description": "D",
               "acceptance": [], "assumptions": []}], "questions": []}"#,
        )
        .expect_err("no criteria");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Field that is not text.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": 42, "description": "D",
               "acceptance": ["C"], "assumptions": []}], "questions": []}"#,
        )
        .expect_err("numeric title");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Empty question.
        let err = parse_generation_output(
            r#"{"proposals": [{"temp_id": "a", "title": "T", "description": "D",
               "acceptance": ["C"], "assumptions": []}], "questions": ["  "]}"#,
        )
        .expect_err("empty question");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Overlong field.
        let long = "z".repeat(MAX_TITLE_CHARS + 1);
        let err = parse_generation_output(&format!(
            "{{\"proposals\": [{{\"temp_id\": \"a\", \"title\": \"{long}\",
              \"description\": \"D\", \"acceptance\": [\"C\"], \"assumptions\": []}}],
              \"questions\": []}}"
        ))
        .expect_err("long title");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
    }
}
