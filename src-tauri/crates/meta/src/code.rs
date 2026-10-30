//! Code proposals with Meta: from ONE saved requirement or ONE saved
//! mockup screen, plus scope files (content saved on disk), the model
//! proposes files with their COMPLETE CONTENT, explanation, assumptions
//! and questions.
//!
//! Same mode as `design`: Responses API with `text.format`
//! (`type: "json_schema"`) and authoritative validation in Rust. The
//! proposal writes nothing: accepting is a later human action, per
//! file, with fingerprint and safe writing (see `ruth-api`).
//!
//! Documented limits: up to 5 files per proposal (64 KiB each), 8
//! context files (8,000 characters each), 1 requirement (4,000
//! characters) or 8 screen sources (4,000 each) plus the screen
//! (6,000), and 80,000 total input characters. Paths are `/`-relative,
//! confined to the sent roots: nothing absolute, no `..` or backslashes.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{redact, MetaError, MetaErrorKind};
use crate::protocol::{classify_transport, parse_error, parse_success_capped, TokenUsage};

/// Instruction template version (recorded per generation). Bumped when the
/// instructions were translated to English: requirement origin is now 2
/// (was 1) and mockup-screen origin is now 3 (was 2); older rows keep
/// describing their original Spanish prompt.
pub const CODE_TEMPLATE_VERSION: u32 = 2;
pub const MOCKUP_CODE_TEMPLATE_VERSION: u32 = 3;
pub const MAX_CODE_FILES: usize = 5;
pub const MAX_CODE_FILE_BYTES: usize = 65_536;
pub const MAX_CODE_SCOPE_FILES: usize = 8;
pub const MAX_CODE_SCOPE_FILE_CHARS: usize = 8_000;
pub const MAX_CODE_REQUIREMENT_CHARS: usize = 4_000;
pub const MAX_CODE_SCREEN_CHARS: usize = 6_000;
pub const MAX_CODE_SCREEN_SOURCES: usize = 8;
pub const MAX_CODE_INPUT_CHARS: usize = 80_000;
pub const MAX_CODE_REL_CHARS: usize = 512;
pub const MAX_CODE_EXPLANATION_CHARS: usize = 2_000;
pub const MAX_CODE_ASSUMPTIONS: usize = 5;
pub const MAX_CODE_QUESTIONS: usize = 5;
pub const MAX_CODE_NOTE_CHARS: usize = 1_000;
/// Person-written adjustment to a proposal: longer text is cut.
pub const MAX_INSTRUCTION_CHARS: usize = 2000;

pub const CODE_MAX_OUTPUT_TOKENS: u32 = 8192;
pub const CODE_TIMEOUT_SECS: u64 = 120;
pub const CODE_MAX_BODY_BYTES: usize = 524_288;

/// Scope file with its SAVED content (never drafts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeScopeFile {
    pub root_id: String,
    pub rel: String,
    pub bytes: u64,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodeOperation {
    Create,
    Modify,
}

impl CodeOperation {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "create" => Some(Self::Create),
            "modify" => Some(Self::Modify),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Modify => "modify",
        }
    }
}

/// Proposed file, validated and ready to record. `content` is the
/// proposed COMPLETE file (review diffs against the current one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedCodeFile {
    pub root_id: String,
    pub rel: String,
    pub operation: CodeOperation,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedCode {
    pub files: Vec<ValidatedCodeFile>,
    pub explanation: String,
    pub assumptions: Vec<String>,
    pub questions: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CodeResult {
    pub code: ValidatedCode,
    pub model: String,
    pub usage: Option<TokenUsage>,
}

const CODE_INSTRUCTION: &str = "Propose code changes for the sent requirement, using the scope files as the base. \
Reply ONLY with the requested JSON object, no extra text. \
Propose files with their COMPLETE CONTENT (no diffs or fragments): files (1 to 5; each with rootId from the sent roots, rel with the relative path using `/`, operation `create` or `modify`, content with the complete file). \
Prefer modifying sent files; create new files only inside the sent roots and with sensible paths. \
Keep the style and existing code except as justified by the requirement; do not invent dependencies, endpoints, credentials or approved decisions. \
Explain the changes (explanation), declare explicit assumptions (assumptions) and leave open questions (questions): never present assumptions as decisions.";

const CODE_SCREEN_INSTRUCTION: &str = "Propose a MINIMAL code edit for the sent mockup screen, using the scope files as the base. \
Reply ONLY with the requested JSON object, no extra text. \
Propose files with their COMPLETE CONTENT (no diffs or fragments): files (1 to 5; each with rootId from the sent roots, rel with the relative path using `/`, operation `create` or `modify`, content with the complete file). \
Prefer modifying sent files; respect the framework, bindings, style and existing hand-written code: change only what the screen justifies. \
The data origin rules: a visual field implies no column; persisted, computed or external concerns beyond the interface are NOT invented (no backend, DTOs, SQL, columns, endpoints or security by assumption): flag them in questions. \
Explain the changes (explanation), declare explicit assumptions (assumptions) and leave open questions (questions): never present assumptions as decisions.";

fn truncate_chars(text: &str, max_chars: usize) -> String {
    crate::design::truncate_chars(text, max_chars)
}

/// Builds the text sent to the model: requirement + scope files.
/// Stable order (root, path); on overflow, whole files drop from the
/// end (the requirement is always kept).
pub fn build_code_input(
    requirement: &crate::generation::GenerationContextItem,
    scope: &[CodeScopeFile],
) -> String {
    let mut files: Vec<&CodeScopeFile> = scope.iter().collect();
    files.sort_by(|a, b| (&a.root_id, &a.rel).cmp(&(&b.root_id, &b.rel)));
    files.truncate(MAX_CODE_SCOPE_FILES);
    let requirement_text = format!(
        "[{} @ {}]\n{}",
        requirement.artifact_id,
        requirement.version_id,
        truncate_chars(requirement.content.trim(), MAX_CODE_REQUIREMENT_CHARS)
    );
    let mut rendered: Vec<String> = files
        .iter()
        .map(|file| {
            format!(
                "--- {}/{} ({} bytes) ---\n{}",
                file.root_id,
                file.rel,
                file.bytes,
                truncate_chars(file.content.trim(), MAX_CODE_SCOPE_FILE_CHARS)
            )
        })
        .collect();
    loop {
        let input = format!(
            "{CODE_INSTRUCTION}\n\nRequirement — saved version:\n{requirement_text}\n\nScope files — saved content ({}):\n{}",
            rendered.len(),
            rendered.join("\n\n")
        );
        if input.chars().count() <= MAX_CODE_INPUT_CHARS || rendered.is_empty() {
            return input;
        }
        rendered.pop();
    }
}

/// Origin screen with its exact sources, already resolved by the api.
/// `screen_text` is the summary of ONE screen (no positions).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeScreenSource {
    pub mockup_artifact_id: String,
    pub version_id: String,
    pub screen_id: String,
    pub screen_title: String,
    pub screen_text: String,
    pub requirements: Vec<crate::generation::GenerationContextItem>,
}

/// Builds the text sent to the model: screen + source requirements +
/// scope files. Stable order on sources and scope; the screen is never
/// trimmed (only its cap); on overflow, whole files drop from the end.
pub fn build_code_input_from_screen(screen: &CodeScreenSource, scope: &[CodeScopeFile]) -> String {
    let mut sources: Vec<&crate::generation::GenerationContextItem> =
        screen.requirements.iter().collect();
    sources.sort_by(|a, b| (&a.artifact_id, &a.version_id).cmp(&(&b.artifact_id, &b.version_id)));
    sources.truncate(MAX_CODE_SCREEN_SOURCES);
    let mut files: Vec<&CodeScopeFile> = scope.iter().collect();
    files.sort_by(|a, b| (&a.root_id, &a.rel).cmp(&(&b.root_id, &b.rel)));
    files.truncate(MAX_CODE_SCOPE_FILES);
    let screen_text = format!(
        "[{}/{} @ {}] {}\n{}",
        screen.mockup_artifact_id,
        screen.screen_id,
        screen.version_id,
        screen.screen_title.trim(),
        truncate_chars(screen.screen_text.trim(), MAX_CODE_SCREEN_CHARS)
    );
    let sources_text = if sources.is_empty() {
        "(the screen cites no requirements: flag the missing information)".to_string()
    } else {
        sources
            .iter()
            .map(|item| {
                format!(
                    "[{} @ {}]\n{}",
                    item.artifact_id,
                    item.version_id,
                    truncate_chars(item.content.trim(), MAX_CODE_REQUIREMENT_CHARS)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let mut rendered: Vec<String> = files
        .iter()
        .map(|file| {
            format!(
                "--- {}/{} ({} bytes) ---\n{}",
                file.root_id,
                file.rel,
                file.bytes,
                truncate_chars(file.content.trim(), MAX_CODE_SCOPE_FILE_CHARS)
            )
        })
        .collect();
    loop {
        let input = format!(
            "{CODE_SCREEN_INSTRUCTION}\n\nScreen — saved version:\n{screen_text}\n\nSource requirements — saved versions ({}):\n{sources_text}\n\nScope files — saved content ({}):\n{}",
            sources.len(),
            rendered.len(),
            rendered.join("\n\n")
        );
        if input.chars().count() <= MAX_CODE_INPUT_CHARS || rendered.is_empty() {
            return input;
        }
        rendered.pop();
    }
}

/// Appends a person request under a fixed heading after the
/// built input. A blank or missing instruction changes nothing;
/// longer ones are cut to `MAX_INSTRUCTION_CHARS`.
pub fn append_instruction(input: String, instruction: Option<&str>) -> String {
    let clean = instruction.map(str::trim).unwrap_or("");
    if clean.is_empty() {
        return input;
    }
    format!(
        "{input}\n\n## Person request\n{}",
        truncate_chars(clean, MAX_INSTRUCTION_CHARS)
    )
}

/// A file of the proposal being adjusted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviousCodeFile {
    pub rel: String,
    pub operation: String,
    pub content: String,
}

/// Appends the proposal being adjusted, so an adjustment changes it
/// instead of starting over. On overflow, whole files drop from the end.
pub fn append_previous_proposal(input: String, files: &[PreviousCodeFile]) -> String {
    let mut rendered: Vec<String> = files
        .iter()
        .map(|file| {
            format!(
                "--- {} ({}) ---\n{}",
                file.rel,
                file.operation,
                truncate_chars(file.content.trim(), MAX_CODE_SCOPE_FILE_CHARS)
            )
        })
        .collect();
    while !rendered.is_empty() {
        let output = format!(
            "{input}\n\n## Previous proposal to adjust\nKeep everything the person does not ask to change.\n{}",
            rendered.join("\n\n")
        );
        if output.chars().count() <= MAX_CODE_INPUT_CHARS {
            return output;
        }
        rendered.pop();
    }
    input
}

/// JSON schema sent in `text.format`.
pub fn code_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_CODE_FILES,
                "items": {
                    "type": "object",
                    "properties": {
                        "rootId": { "type": "string" },
                        "rel": { "type": "string" },
                        "operation": { "type": "string" },
                        "content": { "type": "string" },
                    },
                    "required": ["rootId", "rel", "operation", "content"],
                    "additionalProperties": false
                }
            },
            "explanation": { "type": "string" },
            "assumptions": {
                "type": "array",
                "maxItems": MAX_CODE_ASSUMPTIONS,
                "items": { "type": "string" }
            },
            "questions": {
                "type": "array",
                "maxItems": MAX_CODE_QUESTIONS,
                "items": { "type": "string" }
            },
        },
        "required": ["files", "explanation", "assumptions", "questions"],
        "additionalProperties": false
    })
}

/// Code request body.
pub fn build_code_body(model: &str, input: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "input": input,
        "max_output_tokens": CODE_MAX_OUTPUT_TOKENS,
        "reasoning": { "effort": "minimal" },
        "store": false,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "code_proposal",
                "schema": code_json_schema(),
            }
        },
    })
}

pub(crate) fn invalid(message: impl Into<String>) -> MetaError {
    MetaError::new(MetaErrorKind::InvalidResponse, message.into(), false)
}

/// Lexically safe relative path: no absolutes, no `..`, no backslashes
/// or empty segments. Root authorization and parent-directory existence
/// are verified on accept.
pub fn rel_is_safe(rel: &str) -> bool {
    if rel.is_empty() || rel.chars().count() > MAX_CODE_REL_CHARS {
        return false;
    }
    if rel.contains('\\') || rel.starts_with('/') || rel.ends_with('/') {
        return false;
    }
    !rel.split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn non_empty_capped(text: &str, max_chars: usize) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max_chars {
        return None;
    }
    Some(trimmed.to_string())
}

/// Note list: missing = empty; blanks are dropped and the rest must
/// fit the cap (deterministic).
fn note_items(json: &serde_json::Value, name: &str, max: usize) -> Result<Vec<String>, MetaError> {
    let Some(value) = json.get(name) else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .ok_or_else(|| invalid(format!("'{name}' is not a list")))?;
    let mut out = Vec::new();
    for item in items {
        let text = item
            .as_str()
            .ok_or_else(|| invalid(format!("'{name}' brings an invalid item")))?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > MAX_CODE_NOTE_CHARS {
            return Err(invalid(format!("'{name}' brings an overlong item")));
        }
        out.push(trimmed.to_string());
    }
    if out.len() > max {
        return Err(invalid(format!("'{name}' brings too many items")));
    }
    Ok(out)
}

/// Validates the model text as a code proposal. `allowed_roots` are
/// the roots sent as context: proposing outside them is rejected (the
/// api revalidates before recording).
pub fn parse_code_output(text: &str, allowed_roots: &[String]) -> Result<ValidatedCode, MetaError> {
    let json = crate::generation::extract_json(text).ok_or_else(|| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "The API returned a code proposal that is not valid JSON.",
            false,
        )
    })?;
    let files = json
        .get("files")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("proposal without a file list"))?;
    if files.is_empty() || files.len() > MAX_CODE_FILES {
        return Err(invalid("the proposal brings an invalid file count"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut validated = Vec::with_capacity(files.len());
    for (index, file) in files.iter().enumerate() {
        let nth = index + 1;
        let root_id = file
            .get("rootId")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| invalid(format!("file {nth} without a valid root")))?;
        if !allowed_roots.iter().any(|allowed| allowed == root_id) {
            return Err(invalid(format!("file {nth} outside the sent roots")));
        }
        let rel = file
            .get("rel")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or_default();
        if !rel_is_safe(rel) {
            return Err(invalid(format!("file {nth} with an invalid path")));
        }
        let operation = file
            .get("operation")
            .and_then(|v| v.as_str())
            .and_then(CodeOperation::parse)
            .ok_or_else(|| invalid(format!("file {nth} without a valid operation")))?;
        let content = file
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| invalid(format!("file {nth} without content")))?;
        if content.len() > MAX_CODE_FILE_BYTES {
            return Err(invalid(format!("file {nth} too large")));
        }
        if content.as_bytes().contains(&0) {
            return Err(invalid(format!("file {nth} with NUL bytes")));
        }
        if !seen.insert((root_id.to_string(), rel.to_string())) {
            return Err(invalid(format!("file {nth} duplicated in the proposal")));
        }
        validated.push(ValidatedCodeFile {
            root_id: root_id.to_string(),
            rel: rel.to_string(),
            operation,
            content: content.to_string(),
        });
    }
    let explanation = json
        .get("explanation")
        .and_then(|v| v.as_str())
        .and_then(|t| non_empty_capped(t, MAX_CODE_EXPLANATION_CHARS))
        .ok_or_else(|| invalid("proposal without a valid explanation"))?;
    let assumptions = note_items(&json, "assumptions", MAX_CODE_ASSUMPTIONS)?;
    let questions = note_items(&json, "questions", MAX_CODE_QUESTIONS)?;
    Ok(ValidatedCode {
        files: validated,
        explanation,
        assumptions,
        questions,
    })
}

pub async fn generate_code(
    config: &crate::MetaConfig,
    input: &str,
    allowed_roots: &[String],
) -> Result<CodeResult, MetaError> {
    let secret = config.api_key.expose();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(CODE_TIMEOUT_SECS))
        .build()
        .map_err(|err| MetaError::network(&redact(&err.to_string(), secret)))?;

    let response = client
        .post(crate::protocol::RESPONSES_URL)
        .header("Authorization", format!("Bearer {secret}"))
        .json(&build_code_body(&config.model, input))
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
    if bytes.len() > CODE_MAX_BODY_BYTES {
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
    let parsed = parse_success_capped(status, &body, secret, CODE_MAX_BODY_BYTES)?;
    let validated =
        parse_code_output(&parsed.text, allowed_roots).map_err(|err| err.with_status(status))?;
    Ok(CodeResult {
        code: validated,
        model: parsed.model,
        usage: parsed.usage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generation::GenerationContextItem;

    fn roots() -> Vec<String> {
        vec!["root-1".to_string(), "root-2".to_string()]
    }

    fn proposal(files: serde_json::Value) -> String {
        serde_json::json!({
            "files": files,
            "explanation": "Add the stock discount.",
            "assumptions": ["Stock lives in memory."],
            "questions": ["Discount on reserve or on confirm?"],
        })
        .to_string()
    }

    fn file(root: &str, rel: &str, operation: &str, content: &str) -> serde_json::Value {
        serde_json::json!({
            "rootId": root,
            "rel": rel,
            "operation": operation,
            "content": content,
        })
    }

    #[test]
    fn schema_and_body_ask_json_with_limits() {
        let schema = code_json_schema();
        assert_eq!(schema["type"], serde_json::json!("object"));
        assert_eq!(schema["properties"]["files"]["maxItems"], MAX_CODE_FILES);
        for key in ["files", "explanation", "assumptions", "questions"] {
            assert!(schema["required"]
                .as_array()
                .expect("req")
                .contains(&serde_json::json!(key)));
        }
        let body = build_code_body("m", "hello");
        assert_eq!(body["text"]["format"]["type"], "json_schema");
        assert_eq!(body["text"]["format"]["name"], "code_proposal");
        assert_eq!(body["max_output_tokens"], CODE_MAX_OUTPUT_TOKENS);
        assert_eq!(body["store"], false);
    }

    #[test]
    fn prompt_sorts_and_caps_context() {
        let requirement = GenerationContextItem {
            artifact_id: "req-1".to_string(),
            version_id: "v1".to_string(),
            content: "Descontar stock al confirmar.".to_string(),
        };
        let scope = vec![
            CodeScopeFile {
                root_id: "root-2".to_string(),
                rel: "b.ts".to_string(),
                bytes: 10,
                content: "second".to_string(),
            },
            CodeScopeFile {
                root_id: "root-1".to_string(),
                rel: "a.ts".to_string(),
                bytes: 10,
                content: "first".to_string(),
            },
        ];
        let input = build_code_input(&requirement, &scope);
        assert!(input.contains("[req-1 @ v1]"));
        assert!(input.find("root-1/a.ts").expect("a") < input.find("root-2/b.ts").expect("b"));
        assert!(input.chars().count() <= MAX_CODE_INPUT_CHARS);
        // Nine files: one overflows and the requirement is kept.
        let many: Vec<CodeScopeFile> = (0..9)
            .map(|n| CodeScopeFile {
                root_id: "root-1".to_string(),
                rel: format!("f{n}.ts"),
                bytes: 3,
                content: "x\n".to_string(),
            })
            .collect();
        let input = build_code_input(&requirement, &many);
        assert!(input.contains("[req-1 @ v1]"));
        assert!(input.contains("(8)"));
        assert!(!input.contains("f8.ts"));
    }

    fn screen() -> CodeScreenSource {
        CodeScreenSource {
            mockup_artifact_id: "mock-1".to_string(),
            version_id: "mock-1-v2".to_string(),
            screen_id: "registro".to_string(),
            screen_title: "Registro de usuario".to_string(),
            screen_text: "Pantalla registro (Registro de usuario)\n- campo nombre".to_string(),
            requirements: vec![
                GenerationContextItem {
                    artifact_id: "req-2".to_string(),
                    version_id: "req-2-v1".to_string(),
                    content: "Pedir correo.".to_string(),
                },
                GenerationContextItem {
                    artifact_id: "req-1".to_string(),
                    version_id: "req-1-v3".to_string(),
                    content: "Pedir nombre.".to_string(),
                },
            ],
        }
    }

    #[test]
    fn screen_prompt_sorts_sources_and_invents_no_backend() {
        let input = build_code_input_from_screen(
            &screen(),
            &[CodeScopeFile {
                root_id: "root-1".to_string(),
                rel: "a.ts".to_string(),
                bytes: 10,
                content: "hello".to_string(),
            }],
        );
        assert!(input.contains("[mock-1/registro @ mock-1-v2]"), "{input}");
        assert!(input.contains("Registro de usuario"), "{input}");
        assert!(
            input.find("[req-1 @ req-1-v3]").expect("1")
                < input.find("[req-2 @ req-2-v1]").expect("2"),
            "{input}"
        );
        assert!(input.contains("MINIMAL code edit"), "{input}");
        assert!(input.contains("implies no column"), "{input}");
        assert!(input.contains("are NOT invented"), "{input}");
        assert!(input.contains("root-1/a.ts"), "{input}");
        assert!(input.chars().count() <= MAX_CODE_INPUT_CHARS);
    }

    #[test]
    fn screen_prompt_without_sources_says_so_and_caps_lists() {
        let solitaria = CodeScreenSource {
            requirements: vec![],
            ..screen()
        };
        let input = build_code_input_from_screen(&solitaria, &[]);
        assert!(input.contains("cites no requirements"), "{input}");
        let many_sources: Vec<GenerationContextItem> = (0..10)
            .map(|n| GenerationContextItem {
                artifact_id: format!("req-{n}"),
                version_id: "v1".to_string(),
                content: "x".to_string(),
            })
            .collect();
        let cargada = CodeScreenSource {
            requirements: many_sources,
            ..screen()
        };
        let input = build_code_input_from_screen(&cargada, &[]);
        assert!(input.contains("saved versions (8)"), "{input}");
        assert!(!input.contains("[req-9 @ v1]"), "{input}");
    }

    #[test]
    fn valid_output_creates_and_modifies() {
        let text = proposal(serde_json::json!([
            file("root-1", "src/new.ts", "create", "export const x = 1;\n"),
            file("root-1", "src/old.ts", "modify", "export const y = 2;\n"),
        ]));
        let validated = parse_code_output(&text, &roots()).expect("valid");
        assert_eq!(validated.files.len(), 2);
        assert_eq!(validated.files[0].operation, CodeOperation::Create);
        assert_eq!(validated.files[1].operation, CodeOperation::Modify);
        assert_eq!(validated.assumptions.len(), 1);
        assert_eq!(validated.questions.len(), 1);
    }

    #[test]
    fn rejects_invalid_json_shapes_and_paths() {
        // Not JSON.
        assert!(parse_code_output("hello", &roots()).is_err());
        // No files.
        assert!(parse_code_output(&proposal(serde_json::json!([])), &roots()).is_err());
        // Too many files.
        let many: Vec<serde_json::Value> = (0..6)
            .map(|n| file("root-1", &format!("f{n}.ts"), "create", "x"))
            .collect();
        assert!(parse_code_output(&proposal(serde_json::json!(many)), &roots()).is_err());
        // Duplicate (root, path).
        let dup = serde_json::json!([
            file("root-1", "a.ts", "create", "x"),
            file("root-1", "a.ts", "modify", "y"),
        ]);
        assert!(parse_code_output(&proposal(dup), &roots()).is_err());
        // Unsent root.
        let abroad = serde_json::json!([file("root-9", "a.ts", "create", "x")]);
        assert!(parse_code_output(&proposal(abroad), &roots()).is_err());
        // Unsafe paths.
        for rel in ["../x.ts", "/abs.ts", "a\\b.ts", "a//b.ts", "", "dir/"] {
            let bad = serde_json::json!([file("root-1", rel, "create", "x")]);
            assert!(
                parse_code_output(&proposal(bad), &roots()).is_err(),
                "{rel}"
            );
        }
        // Unknown operation.
        let bad = serde_json::json!([file("root-1", "a.ts", "delete", "x")]);
        assert!(parse_code_output(&proposal(bad), &roots()).is_err());
        // NUL content.
        let bad = serde_json::json!([file("root-1", "a.ts", "create", "a\0b")]);
        assert!(parse_code_output(&proposal(bad), &roots()).is_err());
        // Huge content.
        let big = "x".repeat(MAX_CODE_FILE_BYTES + 1);
        let bad = serde_json::json!([file("root-1", "a.ts", "create", big.as_str())]);
        assert!(parse_code_output(&proposal(bad), &roots()).is_err());
        // Empty explanation.
        let mut no_expl: serde_json::Value =
            serde_json::from_str(&proposal(serde_json::json!([file(
                "root-1", "a.ts", "create", "x"
            )])))
            .expect("json");
        no_expl["explanation"] = serde_json::json!("  ");
        assert!(parse_code_output(&no_expl.to_string(), &roots()).is_err());
        // Too many questions.
        let mut many_q =
            serde_json::from_str::<serde_json::Value>(&proposal(serde_json::json!([file(
                "root-1", "a.ts", "create", "x"
            )])))
            .expect("json");
        many_q["questions"] = serde_json::json!(["1", "2", "3", "4", "5", "6"]);
        assert!(parse_code_output(&many_q.to_string(), &roots()).is_err());
    }

    #[test]
    fn rel_is_safe_covers_edges() {
        for ok in ["a.ts", "src/a.ts", "a.b-c_d/e.ts", ".env"] {
            assert!(rel_is_safe(ok), "{ok}");
        }
        for bad in ["", ".", "..", "a/./b", "a/../b", "/a", "a/", "a\\b", "a//b"] {
            assert!(!rel_is_safe(bad), "{bad}");
        }
        assert!(!rel_is_safe(&"x".repeat(MAX_CODE_REL_CHARS + 1)));
    }

    #[test]
    fn empties_in_notes_are_dropped_without_rejecting() {
        let mut json: serde_json::Value =
            serde_json::from_str(&proposal(serde_json::json!([file(
                "root-1", "a.ts", "create", "x"
            )])))
            .expect("json");
        json["assumptions"] = serde_json::json!(["  ", "One."]);
        json["questions"] = serde_json::json!([]);
        let validated = parse_code_output(&json.to_string(), &roots()).expect("valid");
        assert_eq!(validated.assumptions, vec!["One.".to_string()]);
        assert!(validated.questions.is_empty());
    }
}
