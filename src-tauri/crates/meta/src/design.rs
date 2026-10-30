//! Assisted generation of requirement-linked design (milestone 6).
//!
//! Same mode as `generation`: Responses API with `text.format`
//! (`type: "json_schema"`) and authoritative validation in Rust. Each call
//! generates ONE operation-flow or entity-relationship model proposal from
//! selected requirements (saved versions).
//!
//! ## Initial subset (documented; not a universal UML modeler)
//!
//! Flow: nodes with identity (`[A-Za-z0-9_]`), kind (`start`, `step`,
//! `decision`, `end`), label and referenced requirements; edges with
//! origin, destination and optional label. Cycles in the flow are valid
//! (an operation loop is not a core dependency cycle).
//!
//! ER: entities with name (`[A-Za-z0-9_]`), attributes (name + key mark,
//! NO types: outside the subset) and referenced requirements; relations
//! with endpoints, optional label and cardinalities from the set `1`,
//! `0..1`, `N`, `0..N`.
//!
//! Requirement references use ARTIFACT identifiers (`req-3`), stable
//! across new versions; the exact versions used are recorded separately,
//! at generation level. Every reference must belong to the sent set:
//! anything else is rejected.
//!
//! The canonical JSON is the authoritative content; Mermaid derives from
//! it with `to_mermaid` (deterministic, with escaped labels: the model
//! cannot introduce HTML, scripts, directives or links).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{redact, MetaError, MetaErrorKind};
use crate::protocol::{classify_transport, parse_error, parse_success_capped, TokenUsage};

/// Design instruction template version. v2 (living design) stopped talking
/// about "approved" requirements: it generates from saved versions and asks
/// to flag ambiguities without inventing decisions. v3 is the English
/// translation of the v2 instructions; v1/v2 rows keep describing their
/// original Spanish prompt.
pub const DESIGN_TEMPLATE_VERSION: u32 = 3;
/// Input limits (the context is filtered by `ruth-api` to the active module).
pub const MAX_DESIGN_CONTEXT_ITEMS: usize = 20;
pub const MAX_DESIGN_CONTEXT_CONTENT_CHARS: usize = 2000;
pub const MAX_DESIGN_INPUT_CHARS: usize = 50_000;
/// Per-field and count output limits.
pub const MAX_DESIGN_ID_CHARS: usize = 64;
pub const MAX_DESIGN_TITLE_CHARS: usize = 200;
pub const MAX_DESIGN_LABEL_CHARS: usize = 160;
pub const MAX_DESIGN_EXPLANATION_CHARS: usize = 2000;
pub const MAX_DESIGN_QUESTIONS: usize = 5;
pub const MAX_DESIGN_QUESTION_CHARS: usize = 1000;
pub const MAX_DESIGN_REFS: usize = 8;
pub const MAX_FLOW_NODES: usize = 24;
pub const MAX_FLOW_EDGES: usize = 40;
pub const MAX_ER_ENTITIES: usize = 16;
pub const MAX_ER_ATTRIBUTES: usize = 12;
pub const MAX_ER_RELATIONS: usize = 24;
/// Output limit, timeout and body cap (as with requirements).
pub const DESIGN_MAX_OUTPUT_TOKENS: u32 = 4096;
pub const DESIGN_TIMEOUT_SECS: u64 = 90;
pub const DESIGN_MAX_BODY_BYTES: usize = 262_144;

/// Requested and validated design kind. Matches the core `ArtifactType`
/// (`Flow` ↔ `"flow"`, `DataModel` ↔ `"data_model"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesignKind {
    Flow,
    DataModel,
}

impl DesignKind {
    pub fn parse(kind: &str) -> Result<Self, MetaError> {
        match kind {
            "flow" => Ok(Self::Flow),
            "data_model" => Ok(Self::DataModel),
            other => Err(MetaError::new(
                MetaErrorKind::InvalidResponse,
                format!("unknown design kind: {other}"),
                false,
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Flow => "flow",
            Self::DataModel => "data_model",
        }
    }
}

/// Node kind of the initial flow subset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowNodeKind {
    Start,
    Step,
    Decision,
    End,
}

/// Cardinality of the initial ER subset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cardinality {
    #[serde(rename = "1")]
    One,
    #[serde(rename = "0..1")]
    ZeroOrOne,
    #[serde(rename = "N")]
    Many,
    #[serde(rename = "0..N")]
    ZeroOrMany,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowNode {
    pub id: String,
    pub kind: FlowNodeKind,
    pub label: String,
    #[serde(default)]
    pub requirements: Vec<String>,
    /// `mockup/component` citations motivating the node (informative,
    /// not dependencies). Omitted when empty to keep earlier designs'
    /// canonical form unchanged.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mockups: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowEdge {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErAttribute {
    pub name: String,
    #[serde(default)]
    pub key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErEntity {
    pub name: String,
    pub attributes: Vec<ErAttribute>,
    #[serde(default)]
    pub requirements: Vec<String>,
    /// `mockup/component` citations motivating the entity (informative,
    /// not dependencies). Empty ones are omitted from the canonical form.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mockups: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErRelation {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub label: Option<String>,
    pub from_card: Cardinality,
    pub to_card: Cardinality,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowSpec {
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErSpec {
    pub entities: Vec<ErEntity>,
    pub relations: Vec<ErRelation>,
}

/// Validated proposal, ready to record. The authoritative content is
/// `canonical_json`; Mermaid derives from it and is never stored as source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedDesign {
    pub title: String,
    pub kind: DesignKind,
    pub flow: Option<FlowSpec>,
    pub er: Option<ErSpec>,
    pub explanation: String,
    pub questions: Vec<String>,
}

/// Complete result with call metadata (model and usage, when given).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesignResult {
    pub design: ValidatedDesign,
    pub model: String,
    pub usage: Option<TokenUsage>,
}

const FLOW_INSTRUCTION: &str = "You are a designer proposing an operation flow from requirements (saved versions). \
Reply ONLY with the requested JSON object, no extra text. \
Propose ONE flow: title, nodes (at least one; each with a unique id of letters, digits and underscore, kind among start, step, decision and end, label and requirements with identifiers of the sent requirements), \
edges (existing origin and destination, optional label), brief explanation and questions (at most 5, empty if none). \
Flag ambiguities in questions and never invent decisions as approved.";

const ER_INSTRUCTION: &str = "You are a designer proposing an entity-relationship model from requirements (saved versions). \
Reply ONLY with the requested JSON object, no extra text. \
Propose ONE model: title, entities (at least one; each with a unique name of letters, digits and underscore, attributes with at least one attribute of name and key, and requirements with identifiers of the sent requirements), \
relations (existing endpoints, optional label, from_card and to_card among 1, 0..1, N and 0..N), brief explanation and questions (at most 5, empty if none). \
Do not propose attribute types: they are outside the subset. \
Flag ambiguities in questions and never invent decisions as approved.";

/// Builds the text sent to the model. The context already arrives filtered
/// to selected module requirements; only caps apply here.
pub fn build_design_input(
    kind: DesignKind,
    context: &[crate::generation::GenerationContextItem],
) -> String {
    let instruction = match kind {
        DesignKind::Flow => FLOW_INSTRUCTION,
        DesignKind::DataModel => ER_INSTRUCTION,
    };
    let mut items = context.to_vec();
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    items.truncate(MAX_DESIGN_CONTEXT_ITEMS);
    let mut rendered: Vec<String> = items
        .iter()
        .map(|item| {
            format!(
                "[{} @ {}]\n{}",
                item.artifact_id,
                item.version_id,
                truncate_chars(item.content.trim(), MAX_DESIGN_CONTEXT_CONTENT_CHARS)
            )
        })
        .collect();
    loop {
        let input = format!(
            "{instruction}\n\nSelected requirements — saved versions (context; {}):\n{}",
            rendered.len(),
            rendered.join("\n\n")
        );
        if input.chars().count() <= MAX_DESIGN_INPUT_CHARS || rendered.is_empty() {
            return input;
        }
        rendered.pop();
    }
}

/// Design-from-mockups template version: the same output schema, with
/// instructions that read screens and components, cite what motivates
/// them and only propose technical attributes with justification. v3 is
/// the English translation; v2 rows keep their original Spanish prompt.
pub const DESIGN_MOCKUP_TEMPLATE_VERSION: u32 = 3;

const FLOW_FROM_MOCKUP_INSTRUCTION: &str = "You are a designer proposing an operation flow from mockups and requirements (saved versions). \
Reply ONLY with the requested JSON object, no extra text. \
Read the screens and their components (texts, fields with their declared origin, selectors, buttons with action or destination, tables) and deduce the flow steps and decisions; relate each element to the sent requirements when relevant. \
Propose ONE flow: title, nodes (at least one; each with a unique id of letters, digits and underscore, kind among start, step, decision and end, label, requirements with identifiers of the sent context and optional mockups with mockup/component citations motivating the node), \
edges (existing origin and destination, optional label), brief explanation (include which mockup fields or actions motivate each part) and questions (at most 5, empty if none). \
If any data is missing (for example, you generate only from mockups without requirements), say so in questions: do not invent rules, approvals or certainties. \
Keep in the explanation the elements a person must review by hand.";

const ER_FROM_MOCKUP_INSTRUCTION: &str = "You are a designer proposing an entity-relationship model from mockups and requirements (saved versions). \
Reply ONLY with the requested JSON object, no extra text. \
Read the screens and their components; fields and tables with persisted origin suggest stored data, while calculated, temporary, external or undefined do NOT imply columns: if you reflect them, explain it as an assumption. \
A screen is NOT an entity nor a field a column: propose entities and attributes only with justification in requirements or mockups. \
Propose ONE model: title, entities (at least one; each with a unique name of letters, digits and underscore, attributes with at least one attribute of name and key, requirements with identifiers of the sent context and optional mockups with mockup/component citations motivating the entity), \
relations (existing endpoints, optional label, from_card and to_card among 1, 0..1, N and 0..N), brief explanation (include which mockup fields or tables motivate each entity) and questions (at most 5, empty if none). \
Do not propose attribute types: they are outside the subset. \
Technical attributes (created_at, updated_at, deleted_at, expirations) only when the context justifies them, explained as an assumption: never by default. \
If any data is missing (for example, you generate only from mockups without requirements), say so in questions: do not invent rules, approvals or certainties.";

/// Builds the text for proposing a design from saved mockups and
/// requirements. Mockups travel as a readable summary (no positions);
/// at least one context element is mandatory and the same caps as
/// requirement-based creation apply.
pub fn build_mockup_design_input(
    kind: DesignKind,
    requirements: &[crate::generation::GenerationContextItem],
    mockups: &[crate::generation::GenerationContextItem],
) -> String {
    let instruction = match kind {
        DesignKind::Flow => FLOW_FROM_MOCKUP_INSTRUCTION,
        DesignKind::DataModel => ER_FROM_MOCKUP_INSTRUCTION,
    };
    let mut reqs = requirements.to_vec();
    reqs.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    let mut mocks = mockups.to_vec();
    mocks.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    let mut rendered: Vec<String> = Vec::new();
    for item in reqs.iter().take(MAX_DESIGN_CONTEXT_ITEMS) {
        rendered.push(format!(
            "[{} @ {}]\n{}",
            item.artifact_id,
            item.version_id,
            truncate_chars(item.content.trim(), MAX_DESIGN_CONTEXT_CONTENT_CHARS)
        ));
    }
    for item in mocks.iter().take(MAX_DESIGN_CONTEXT_ITEMS) {
        rendered.push(format!(
            "[{} @ {}]\n{}",
            item.artifact_id,
            item.version_id,
            crate::mockup::render_mockup_excerpt(&item.content, MAX_DESIGN_CONTEXT_CONTENT_CHARS)
        ));
    }
    rendered.truncate(MAX_DESIGN_CONTEXT_ITEMS);
    loop {
        let input = format!(
            "{instruction}\n\nSaved context — {} requirements, {} mockups:\n{}",
            reqs.len().min(MAX_DESIGN_CONTEXT_ITEMS),
            mocks.len().min(MAX_DESIGN_CONTEXT_ITEMS),
            rendered.join("\n\n")
        );
        if input.chars().count() <= MAX_DESIGN_INPUT_CHARS || rendered.is_empty() {
            return input;
        }
        rendered.pop();
    }
}

/// JSON schema sent in `text.format` for the requested kind.
pub fn design_json_schema(kind: DesignKind) -> serde_json::Value {
    let questions = serde_json::json!({
        "type": "array",
        "maxItems": MAX_DESIGN_QUESTIONS,
        "items": { "type": "string" }
    });
    let requirements = serde_json::json!({
        "type": "array",
        "maxItems": MAX_DESIGN_REFS,
        "items": { "type": "string" }
    });
    let mockups = serde_json::json!({
        "type": "array",
        "maxItems": MAX_DESIGN_REFS,
        "items": { "type": "string" }
    });
    let spec = match kind {
        DesignKind::Flow => serde_json::json!({
            "nodes": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_FLOW_NODES,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "kind": { "type": "string" },
                        "label": { "type": "string" },
                        "requirements": requirements,
                        "mockups": mockups,
                    },
                    "required": ["id", "kind", "label", "requirements"],
                    "additionalProperties": false
                }
            },
            "edges": {
                "type": "array",
                "maxItems": MAX_FLOW_EDGES,
                "items": {
                    "type": "object",
                    "properties": {
                        "from": { "type": "string" },
                        "to": { "type": "string" },
                        "label": { "type": "string" },
                    },
                    "required": ["from", "to"],
                    "additionalProperties": false
                }
            }
        }),
        DesignKind::DataModel => serde_json::json!({
            "entities": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_ER_ENTITIES,
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "attributes": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": MAX_ER_ATTRIBUTES,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "key": { "type": "boolean" },
                                },
                                "required": ["name"],
                                "additionalProperties": false
                            }
                        },
                        "requirements": requirements,
                        "mockups": mockups,
                    },
                    "required": ["name", "attributes", "requirements"],
                    "additionalProperties": false
                }
            },
            "relations": {
                "type": "array",
                "maxItems": MAX_ER_RELATIONS,
                "items": {
                    "type": "object",
                    "properties": {
                        "from": { "type": "string" },
                        "to": { "type": "string" },
                        "label": { "type": "string" },
                        "from_card": { "type": "string" },
                        "to_card": { "type": "string" },
                    },
                    "required": ["from", "to", "from_card", "to_card"],
                    "additionalProperties": false
                }
            }
        }),
    };
    let mut properties = serde_json::Map::new();
    properties.insert("title".to_string(), serde_json::json!({ "type": "string" }));
    for (key, value) in spec.as_object().expect("object") {
        properties.insert(key.clone(), value.clone());
    }
    properties.insert(
        "explanation".to_string(),
        serde_json::json!({ "type": "string" }),
    );
    properties.insert("questions".to_string(), questions);
    let required: Vec<&str> = match kind {
        DesignKind::Flow => vec!["title", "nodes", "edges", "explanation", "questions"],
        DesignKind::DataModel => {
            vec!["title", "entities", "relations", "explanation", "questions"]
        }
    };
    serde_json::json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

/// Design request body.
pub fn build_design_body(kind: DesignKind, model: &str, input: &str) -> serde_json::Value {
    let name = match kind {
        DesignKind::Flow => "operation_flow",
        DesignKind::DataModel => "er_model",
    };
    serde_json::json!({
        "model": model,
        "input": input,
        "max_output_tokens": DESIGN_MAX_OUTPUT_TOKENS,
        "reasoning": { "effort": "minimal" },
        "store": false,
        "text": {
            "format": {
                "type": "json_schema",
                "name": name,
                "schema": design_json_schema(kind),
            }
        },
    })
}

pub(crate) fn invalid(message: impl Into<String>) -> MetaError {
    MetaError::new(MetaErrorKind::InvalidResponse, message.into(), false)
}

/// Validates the model text as a design proposal of the requested kind.
/// `allowed` are the artifact identifiers sent as context: every
/// reference must belong to the set. Rejects without creating anything
/// on missing JSON, missing or wrong kind, invalid fields, duplicate
/// ids, missing references or disallowed cardinalities.
pub fn parse_design_output(
    text: &str,
    kind: DesignKind,
    allowed: &[String],
) -> Result<ValidatedDesign, MetaError> {
    let json = crate::generation::extract_json(text).ok_or_else(|| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "The API returned a design that is not valid JSON.",
            false,
        )
    })?;
    let title = string_field(&json, "title")
        .and_then(|t| non_empty(&t, MAX_DESIGN_TITLE_CHARS))
        .ok_or_else(|| invalid("design without a valid title"))?;
    let explanation = string_field(&json, "explanation")
        .and_then(|t| non_empty(&t, MAX_DESIGN_EXPLANATION_CHARS))
        .ok_or_else(|| invalid("design without a valid explanation"))?;
    let questions = string_items(&json, "questions", 0, MAX_DESIGN_QUESTIONS)?;
    let (flow, er) = match kind {
        DesignKind::Flow => (Some(parse_flow(&json, allowed)?), None),
        DesignKind::DataModel => (None, Some(parse_er(&json, allowed)?)),
    };
    Ok(ValidatedDesign {
        title,
        kind,
        flow,
        er,
        explanation,
        questions,
    })
}

/// Revalidates an edited spec (already parsed JSON) against the kind and
/// the allowed set. Same validation as the model output.
pub fn validate_design_value(
    kind: DesignKind,
    value: &serde_json::Value,
    allowed: &[String],
) -> Result<ValidatedDesign, MetaError> {
    let text = serde_json::to_string(value).map_err(|_| invalid("spec not serializable"))?;
    parse_design_output(&text, kind, allowed)
}

/// Authoritative canonical content: fixed serialization of the validated.
/// It is what is saved in the version on accept; Mermaid derives from here.
pub fn canonical_json(design: &ValidatedDesign) -> String {
    let mut map = serde_json::Map::new();
    map.insert("title".to_string(), serde_json::json!(design.title));
    map.insert("kind".to_string(), serde_json::json!(design.kind.as_str()));
    match (&design.flow, &design.er) {
        (Some(flow), _) => {
            map.insert("nodes".to_string(), serde_json::json!(flow.nodes));
            map.insert("edges".to_string(), serde_json::json!(flow.edges));
        }
        (_, Some(er)) => {
            map.insert("entities".to_string(), serde_json::json!(er.entities));
            map.insert("relations".to_string(), serde_json::json!(er.relations));
        }
        (None, None) => {}
    }
    map.insert(
        "explanation".to_string(),
        serde_json::json!(design.explanation),
    );
    map.insert("questions".to_string(), serde_json::json!(design.questions));
    serde_json::to_string(&map).expect("validated serializes")
}

/// Serializes the validated to Mermaid deterministically. Labels are
/// escaped (no quotes, directives or HTML possible) and identifiers already
/// come restricted by validation: the model cannot inject anything.
pub fn to_mermaid(design: &ValidatedDesign) -> String {
    match (&design.flow, &design.er) {
        (Some(flow), _) => flow_mermaid(flow),
        (_, Some(er)) => er_mermaid(er),
        (None, None) => "flowchart TD\n".to_string(),
    }
}

fn flow_mermaid(flow: &FlowSpec) -> String {
    let mut out = String::from("flowchart TD\n");
    for node in &flow.nodes {
        let (open, close) = match node.kind {
            FlowNodeKind::Start | FlowNodeKind::End => ("([\"", "\"])"),
            FlowNodeKind::Step => ("[\"", "\"]"),
            FlowNodeKind::Decision => ("{\"", "\"}"),
        };
        out.push_str(&format!(
            "    {}{}{}{}\n",
            node.id,
            open,
            escape_label(&node.label),
            close
        ));
    }
    for edge in &flow.edges {
        match &edge.label {
            Some(label) => out.push_str(&format!(
                "    {} -- \"{}\" --> {}\n",
                edge.from,
                escape_label(label),
                edge.to
            )),
            None => out.push_str(&format!("    {} --> {}\n", edge.from, edge.to)),
        }
    }
    out
}

fn er_mermaid(er: &ErSpec) -> String {
    let mut out = String::from("erDiagram\n");
    for entity in &er.entities {
        out.push_str(&format!("    {} {{\n", entity.name));
        for attr in &entity.attributes {
            // No types in the initial subset: fixed `string` type.
            if attr.key {
                out.push_str(&format!("        string {} PK\n", attr.name));
            } else {
                out.push_str(&format!("        string {}\n", attr.name));
            }
        }
        out.push_str("    }\n");
    }
    for relation in &er.relations {
        out.push_str(&format!(
            "    {} {}--{} {}",
            relation.from,
            card_symbol(relation.from_card),
            card_symbol(relation.to_card),
            relation.to,
        ));
        // erDiagram requires `: label` on each relation: without it Mermaid
        // does not compile (`Expecting COLON`). It is quoted (may contain
        // spaces) and `rel` covers absence; escaping already removed
        // quotes, directives and injections.
        let raw = relation.label.as_deref().unwrap_or("rel");
        let clean = escape_label(raw);
        let label = if clean.is_empty() {
            "rel"
        } else {
            clean.as_str()
        };
        out.push_str(&format!(" : \"{label}\"\n"));
    }
    out
}

fn card_symbol(card: Cardinality) -> &'static str {
    match card {
        Cardinality::One => "||",
        Cardinality::ZeroOrOne => "|o",
        Cardinality::Many => "}|",
        Cardinality::ZeroOrMany => "}o",
    }
}

/// Escapes a label for Mermaid: out with quotes, directives (`%%`),
/// HTML and diagram-meaningful characters. Deterministic.
fn escape_label(label: &str) -> String {
    let mut clean = String::with_capacity(label.len());
    for ch in label.chars() {
        let risky = matches!(
            ch,
            '"' | '#'
                | '`'
                | '<'
                | '>'
                | '{'
                | '}'
                | '['
                | ']'
                | '('
                | ')'
                | '|'
                | ';'
                | '%'
                | ':'
                | '/'
                | '\n'
                | '\r'
                | '\t'
        );
        clean.push(if risky { ' ' } else { ch });
    }
    clean.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_flow(json: &serde_json::Value, allowed: &[String]) -> Result<FlowSpec, MetaError> {
    let nodes = json
        .get("nodes")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("flow without a node list"))?;
    if nodes.is_empty() || nodes.len() > MAX_FLOW_NODES {
        return Err(invalid(format!(
            "the flow must have between 1 and {MAX_FLOW_NODES} nodes"
        )));
    }
    let edges = json
        .get("edges")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("flow without an edge list"))?;
    if edges.len() > MAX_FLOW_EDGES {
        return Err(invalid(format!(
            "too many edges: {} (max {MAX_FLOW_EDGES})",
            edges.len()
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out_nodes = Vec::with_capacity(nodes.len());
    for (i, node) in nodes.iter().enumerate() {
        let n = i + 1;
        let id = string_field(node, "id")
            .filter(|id| valid_id(id))
            .ok_or_else(|| invalid(format!("node {n}: invalid identifier")))?;
        if !seen.insert(id.clone()) {
            return Err(invalid(format!("node {n}: duplicate identifier")));
        }
        let kind: FlowNodeKind = node
            .get("kind")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| invalid(format!("node {n}: invalid kind")))?;
        let label = string_field(node, "label")
            .and_then(|t| non_empty(&t, MAX_DESIGN_LABEL_CHARS))
            .ok_or_else(|| invalid(format!("node {n}: empty or oversized label")))?;
        let requirements = ref_items(node, "requirements", n, allowed, "node")?;
        let mockups = mockup_ref_items(node, n, allowed, "node")?;
        out_nodes.push(FlowNode {
            id,
            kind,
            label,
            requirements,
            mockups,
        });
    }
    let mut out_edges = Vec::with_capacity(edges.len());
    for (i, edge) in edges.iter().enumerate() {
        let n = i + 1;
        let from = string_field(edge, "from")
            .ok_or_else(|| invalid(format!("edge {n}: missing origin")))?;
        let to = string_field(edge, "to")
            .ok_or_else(|| invalid(format!("edge {n}: missing destination")))?;
        if !seen.contains(&from) {
            return Err(invalid(format!("edge {n}: dangling origin")));
        }
        if !seen.contains(&to) {
            return Err(invalid(format!("edge {n}: dangling destination")));
        }
        let label = match edge.get("label") {
            None | Some(serde_json::Value::Null) => None,
            Some(value) => {
                let text = value
                    .as_str()
                    .ok_or_else(|| invalid(format!("edge {n}: non-text label")))?;
                Some(
                    non_empty(text, MAX_DESIGN_LABEL_CHARS)
                        .ok_or_else(|| invalid(format!("edge {n}: empty or oversized label")))?,
                )
            }
        };
        out_edges.push(FlowEdge { from, to, label });
    }
    Ok(FlowSpec {
        nodes: out_nodes,
        edges: out_edges,
    })
}

fn parse_er(json: &serde_json::Value, allowed: &[String]) -> Result<ErSpec, MetaError> {
    let entities = json
        .get("entities")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("model without an entity list"))?;
    if entities.is_empty() || entities.len() > MAX_ER_ENTITIES {
        return Err(invalid(format!(
            "the model must have between 1 and {MAX_ER_ENTITIES} entities"
        )));
    }
    let relations = json
        .get("relations")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("model without a relation list"))?;
    if relations.len() > MAX_ER_RELATIONS {
        return Err(invalid(format!(
            "too many relations: {} (max {MAX_ER_RELATIONS})",
            relations.len()
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out_entities = Vec::with_capacity(entities.len());
    for (i, entity) in entities.iter().enumerate() {
        let n = i + 1;
        let name = string_field(entity, "name")
            .filter(|name| valid_id(name))
            .ok_or_else(|| invalid(format!("entity {n}: invalid name")))?;
        if !seen.insert(name.clone()) {
            return Err(invalid(format!("entity {n}: duplicate name")));
        }
        let attributes = entity
            .get("attributes")
            .and_then(|v| v.as_array())
            .ok_or_else(|| invalid(format!("entity {n}: missing attribute list")))?;
        if attributes.is_empty() || attributes.len() > MAX_ER_ATTRIBUTES {
            return Err(invalid(format!(
                "entity {n}: between 1 and {MAX_ER_ATTRIBUTES} attributes"
            )));
        }
        let mut seen_attrs = std::collections::HashSet::new();
        let mut out_attrs = Vec::with_capacity(attributes.len());
        for (j, attr) in attributes.iter().enumerate() {
            let m = j + 1;
            let attr_name = string_field(attr, "name")
                .filter(|name| valid_id(name))
                .ok_or_else(|| invalid(format!("entity {n}: invalid attribute {m}")))?;
            if !seen_attrs.insert(attr_name.clone()) {
                return Err(invalid(format!("entity {n}: duplicate attribute")));
            }
            let key = attr.get("key").and_then(|v| v.as_bool()).unwrap_or(false);
            out_attrs.push(ErAttribute {
                name: attr_name,
                key,
            });
        }
        let requirements = ref_items(entity, "requirements", n, allowed, "entity")?;
        let mockups = mockup_ref_items(entity, n, allowed, "entity")?;
        out_entities.push(ErEntity {
            name,
            attributes: out_attrs,
            requirements,
            mockups,
        });
    }
    let mut out_relations = Vec::with_capacity(relations.len());
    for (i, relation) in relations.iter().enumerate() {
        let n = i + 1;
        let from = string_field(relation, "from")
            .ok_or_else(|| invalid(format!("relation {n}: missing origin")))?;
        let to = string_field(relation, "to")
            .ok_or_else(|| invalid(format!("relation {n}: missing destination")))?;
        if !seen.contains(&from) {
            return Err(invalid(format!("relation {n}: dangling origin")));
        }
        if !seen.contains(&to) {
            return Err(invalid(format!("relation {n}: dangling destination")));
        }
        let label =
            match relation.get("label") {
                None | Some(serde_json::Value::Null) => None,
                Some(value) => {
                    let text = value
                        .as_str()
                        .ok_or_else(|| invalid(format!("relation {n}: non-text label")))?;
                    Some(non_empty(text, MAX_DESIGN_LABEL_CHARS).ok_or_else(|| {
                        invalid(format!("relation {n}: empty or oversized label"))
                    })?)
                }
            };
        let from_card: Cardinality = relation
            .get("from_card")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| invalid(format!("relation {n}: disallowed origin cardinality")))?;
        let to_card: Cardinality = relation
            .get("to_card")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| invalid(format!("relation {n}: disallowed destination cardinality")))?;
        out_relations.push(ErRelation {
            from,
            to,
            label,
            from_card,
            to_card,
        });
    }
    Ok(ErSpec {
        entities: out_entities,
        relations: out_relations,
    })
}

pub(crate) fn string_field(value: &serde_json::Value, name: &str) -> Option<String> {
    value.get(name)?.as_str().map(str::to_string)
}

pub(crate) fn non_empty(text: &str, max_chars: usize) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max_chars {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn valid_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && id.chars().count() <= MAX_DESIGN_ID_CHARS
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Requirement references: inside the sent set, no duplicates, with a
/// cap. Empty allowed (not every element cites requirements).
fn ref_items(
    parent: &serde_json::Value,
    name: &str,
    n: usize,
    allowed: &[String],
    what: &str,
) -> Result<Vec<String>, MetaError> {
    let values = parent
        .get(name)
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid(format!("{what} {n}: missing {name} or not a list")))?;
    if values.len() > MAX_DESIGN_REFS {
        return Err(invalid(format!(
            "{what} {n}: too many references (max {MAX_DESIGN_REFS})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("{what} {n}: non-text reference")))?;
        let text = text.trim().to_string();
        if text.is_empty() || !allowed.contains(&text) {
            return Err(invalid(format!(
                "{what} {n}: reference outside the sent set"
            )));
        }
        if !seen.insert(text.clone()) {
            return Err(invalid(format!("{what} {n}: duplicate reference")));
        }
        out.push(text);
    }
    Ok(out)
}

/// `mockup/component` citations motivating a node or entity. Optional
/// (missing or null = empty); with a cap, no duplicates and the mockup
/// inside the sent set. Symmetric to `designs` in mockups: informative,
/// never core dependencies.
fn mockup_ref_items(
    parent: &serde_json::Value,
    n: usize,
    allowed: &[String],
    what: &str,
) -> Result<Vec<String>, MetaError> {
    let Some(node) = parent.get("mockups") else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    };
    let values = node
        .as_array()
        .ok_or_else(|| invalid(format!("{what} {n}: mockups is not a list")))?;
    if values.len() > MAX_DESIGN_REFS {
        return Err(invalid(format!(
            "{what} {n}: too many citations (max {MAX_DESIGN_REFS})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("{what} {n}: non-text citation")))?;
        let (artifact, element) = text.split_once('/').ok_or_else(|| {
            invalid(format!(
                "{what} {n}: citation without mockup/component shape ({text})"
            ))
        })?;
        if !allowed.contains(&artifact.to_string()) || !valid_id(element) {
            return Err(invalid(format!(
                "{what} {n}: citation outside the sent set ({text})"
            )));
        }
        if !seen.insert(text.to_string()) {
            return Err(invalid(format!("{what} {n}: duplicate citation")));
        }
        out.push(text.to_string());
    }
    Ok(out)
}

fn string_items(
    json: &serde_json::Value,
    name: &str,
    min: usize,
    max: usize,
) -> Result<Vec<String>, MetaError> {
    let values = json
        .get(name)
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid(format!("missing {name} or not a list")))?;
    if values.len() < min || values.len() > max {
        return Err(invalid(format!(
            "{name} must have between {min} and {max} items"
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for (i, value) in values.iter().enumerate() {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("{name}[{}] is not text", i + 1)))?;
        let text = non_empty(text, MAX_DESIGN_QUESTION_CHARS)
            .ok_or_else(|| invalid(format!("{name}[{}] empty or oversized", i + 1)))?;
        out.push(text);
    }
    Ok(out)
}

pub(crate) fn truncate_chars(text: &str, max_chars: usize) -> String {
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

/// Runs a design generation: a single POST without retries, with its own
/// timeout and body cap. Same error classification as the other calls.
/// `allowed` are the artifacts sent as context.
pub async fn generate_design(
    config: &crate::MetaConfig,
    kind: DesignKind,
    input: &str,
    allowed: &[String],
) -> Result<DesignResult, MetaError> {
    let secret = config.api_key.expose();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DESIGN_TIMEOUT_SECS))
        .build()
        .map_err(|err| MetaError::network(&redact(&err.to_string(), secret)))?;

    let response = client
        .post(crate::protocol::RESPONSES_URL)
        .header("Authorization", format!("Bearer {secret}"))
        .json(&build_design_body(kind, &config.model, input))
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
    if bytes.len() > DESIGN_MAX_BODY_BYTES {
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
    let parsed = parse_success_capped(status, &body, secret, DESIGN_MAX_BODY_BYTES)?;
    let validated =
        parse_design_output(&parsed.text, kind, allowed).map_err(|err| err.with_status(status))?;
    Ok(DesignResult {
        design: validated,
        model: parsed.model,
        usage: parsed.usage,
    })
}

/// Update template version (milestone 8): the same milestone-6 output
/// schema, with adjustment instructions instead of creation ones. v3 is
/// the English translation; v2 rows keep their original Spanish prompt.
pub const DESIGN_UPDATE_TEMPLATE_VERSION: u32 = 3;

const FLOW_UPDATE_INSTRUCTION: &str = "You are a designer PROPOSING ADJUSTMENTS to an existing operation flow because its source requirements changed. \
Reply ONLY with the requested JSON object, no extra text. \
Keep everything that needs no change and retain existing element identifiers when possible; adjust only what the current requirements justify. \
Propose the updated COMPLETE flow: title, nodes (unique id of letters, digits and underscore, kind among start, step, decision and end, label and requirements with identifiers of the sent requirements), \
edges (existing origin and destination, optional label), brief explanation of WHAT changed and WHY, and questions (at most 5, empty if none). \
Flag uncertainties in questions and do not present assumptions as approved decisions.";

const ER_UPDATE_INSTRUCTION: &str = "You are a designer PROPOSING ADJUSTMENTS to an existing entity-relationship model because its source requirements changed. \
Reply ONLY with the requested JSON object, no extra text. \
Keep everything that needs no change and retain existing entity, attribute and relation names when possible; adjust only what the current requirements justify. \
Keep hand-written technical attributes (created_at, updated_at, deleted_at, expirations) even when missing from the new context: do not delete them for not seeing them on a screen. \
Propose the updated COMPLETE model: title, entities (unique name of letters, digits and underscore, attributes with name and key, requirements with identifiers of the sent requirements), \
relations (existing endpoints, optional label, from_card and to_card among 1, 0..1, N and 0..N), brief explanation of WHAT changed and WHY, and questions (at most 5, empty if none). \
Do not propose attribute types: they are outside the subset. \
Flag uncertainties in questions and do not present assumptions as approved decisions.";

/// Design source with its used version and its current version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateSource {
    pub artifact_id: String,
    pub used_version_id: String,
    pub used_content: String,
    pub current_version_id: String,
    pub current_content: String,
}

/// Change of the requirement that caused the impact report, if known.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginChange {
    pub artifact_id: String,
    pub from_version_id: String,
    pub from_content: String,
    pub current_version_id: String,
    pub current_content: String,
}

/// Builds the input for proposing a design update: the current design
/// (canonical JSON), each source with its used and current version, the
/// origin change and the relevant paths. Same caps as creation.
pub fn build_update_input(
    kind: DesignKind,
    current_spec: &str,
    sources: &[UpdateSource],
    origin: Option<&OriginChange>,
    paths: &[Vec<String>],
) -> String {
    let instruction = match kind {
        DesignKind::Flow => FLOW_UPDATE_INSTRUCTION,
        DesignKind::DataModel => ER_UPDATE_INSTRUCTION,
    };
    let mut items: Vec<UpdateSource> = sources.to_vec();
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    items.truncate(MAX_DESIGN_CONTEXT_ITEMS);
    let mut rendered: Vec<String> = items
        .iter()
        .map(|item| {
            if item.used_version_id == item.current_version_id {
                format!(
                    "[{} @ {} (unchanged)]\n{}",
                    item.artifact_id,
                    item.current_version_id,
                    truncate_chars(
                        item.current_content.trim(),
                        MAX_DESIGN_CONTEXT_CONTENT_CHARS
                    )
                )
            } else {
                format!(
                    "[{}]\nused {}:\n{}\ncurrent {}:\n{}",
                    item.artifact_id,
                    item.used_version_id,
                    truncate_chars(item.used_content.trim(), MAX_DESIGN_CONTEXT_CONTENT_CHARS),
                    item.current_version_id,
                    truncate_chars(
                        item.current_content.trim(),
                        MAX_DESIGN_CONTEXT_CONTENT_CHARS
                    )
                )
            }
        })
        .collect();
    let spec = truncate_chars(current_spec.trim(), MAX_DESIGN_INPUT_CHARS / 2);
    let origin_text = match origin {
        Some(change) => format!(
            "\n\nChange that caused the impact [{} {} → {}]:\nbefore:\n{}\nafter:\n{}",
            change.artifact_id,
            change.from_version_id,
            change.current_version_id,
            truncate_chars(change.from_content.trim(), MAX_DESIGN_CONTEXT_CONTENT_CHARS),
            truncate_chars(
                change.current_content.trim(),
                MAX_DESIGN_CONTEXT_CONTENT_CHARS
            )
        ),
        None => String::new(),
    };
    let mut path_lines: Vec<String> = paths
        .iter()
        .take(MAX_DESIGN_CONTEXT_ITEMS)
        .map(|path| path.join(" → "))
        .collect();
    loop {
        let paths_text = if path_lines.is_empty() {
            String::new()
        } else {
            format!("\n\nDependency paths:\n{}", path_lines.join("\n"))
        };
        let input = format!(
            "{instruction}\n\nCurrent design (JSON to update):\n{spec}\n\nUsed vs current sources ({}):\n{}{origin_text}{paths_text}",
            rendered.len(),
            rendered.join("\n\n")
        );
        if input.chars().count() <= MAX_DESIGN_INPUT_CHARS
            || (rendered.is_empty() && path_lines.is_empty())
        {
            return input;
        }
        if !rendered.is_empty() {
            rendered.pop();
        } else {
            path_lines.pop();
        }
    }
}

/// Structural diff item: `kind` is `title`, `node`, `edge`, `entity`,
/// `attribute` or `relation`; `detail` describes the change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffItem {
    pub kind: String,
    pub id: String,
    pub detail: String,
}

/// Deterministic structural differences between two validated designs of
/// the same kind. Changed identifiers show as addition+removal: no
/// equivalences are ever invented.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignDiff {
    pub added: Vec<DiffItem>,
    pub removed: Vec<DiffItem>,
    pub modified: Vec<DiffItem>,
}

fn kind_order(kind: &str) -> usize {
    match kind {
        "title" => 0,
        "node" => 1,
        "edge" => 2,
        "entity" => 3,
        "attribute" => 4,
        "relation" => 5,
        _ => 6,
    }
}

fn sort_items(items: &mut [DiffItem]) {
    items.sort_by(|a, b| {
        kind_order(&a.kind)
            .cmp(&kind_order(&b.kind))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn joined(items: &[String]) -> String {
    let mut sorted = items.to_vec();
    sorted.sort();
    sorted.join(", ")
}

/// Diff between the current and the proposed design. Requires the same
/// kind on both; a different kind is a caller programming error.
#[derive(Default)]
struct DiffAcc {
    added: Vec<DiffItem>,
    removed: Vec<DiffItem>,
    modified: Vec<DiffItem>,
}

pub fn diff_designs(old: &ValidatedDesign, new: &ValidatedDesign) -> Result<DesignDiff, MetaError> {
    if old.kind != new.kind {
        return Err(invalid("designs of different kinds are not compared"));
    }
    let mut acc = DiffAcc::default();
    if old.title != new.title {
        acc.modified.push(DiffItem {
            kind: "title".to_string(),
            id: "title".to_string(),
            detail: format!("\"{}\" → \"{}\"", old.title, new.title),
        });
    }
    match (&old.flow, &new.flow) {
        (Some(before), Some(after)) => diff_flow(before, after, &mut acc),
        (None, None) => {}
        _ => return Err(invalid("designs of different kinds are not compared")),
    }
    match (&old.er, &new.er) {
        (Some(before), Some(after)) => diff_er(before, after, &mut acc),
        (None, None) => {}
        _ => return Err(invalid("designs of different kinds are not compared")),
    }
    sort_items(&mut acc.added);
    sort_items(&mut acc.removed);
    sort_items(&mut acc.modified);
    Ok(DesignDiff {
        added: acc.added,
        removed: acc.removed,
        modified: acc.modified,
    })
}

fn diff_flow(before: &FlowSpec, after: &FlowSpec, acc: &mut DiffAcc) {
    let mut old_nodes = std::collections::HashMap::new();
    for node in &before.nodes {
        old_nodes.insert(node.id.clone(), node);
    }
    let mut new_nodes = std::collections::HashMap::new();
    for node in &after.nodes {
        new_nodes.insert(node.id.clone(), node);
    }
    for (id, node) in &new_nodes {
        if !old_nodes.contains_key(id) {
            acc.added.push(DiffItem {
                kind: "node".to_string(),
                id: id.clone(),
                detail: format!("{:?} \"{}\"", node.kind, node.label),
            });
        }
    }
    for (id, node) in &old_nodes {
        if !new_nodes.contains_key(id) {
            acc.removed.push(DiffItem {
                kind: "node".to_string(),
                id: id.clone(),
                detail: format!("{:?} \"{}\"", node.kind, node.label),
            });
        }
    }
    for (id, node) in &new_nodes {
        let Some(prev) = old_nodes.get(id) else {
            continue;
        };
        let mut changes = Vec::new();
        if prev.kind != node.kind {
            changes.push(format!("kind {:?} → {:?}", prev.kind, node.kind));
        }
        if prev.label != node.label {
            changes.push(format!("label \"{}\" → \"{}\"", prev.label, node.label));
        }
        if joined(&prev.requirements) != joined(&node.requirements) {
            changes.push(format!(
                "requirements [{}] → [{}]",
                joined(&prev.requirements),
                joined(&node.requirements)
            ));
        }
        if joined(&prev.mockups) != joined(&node.mockups) {
            changes.push(format!(
                "mockups [{}] → [{}]",
                joined(&prev.mockups),
                joined(&node.mockups)
            ));
        }
        if !changes.is_empty() {
            acc.modified.push(DiffItem {
                kind: "node".to_string(),
                id: id.clone(),
                detail: changes.join("; "),
            });
        }
    }
    diff_edges(&before.edges, &after.edges, acc);
}

fn edge_key(from: &str, to: &str) -> String {
    format!("{from} → {to}")
}

fn diff_edges(before: &[FlowEdge], after: &[FlowEdge], acc: &mut DiffAcc) {
    let mut old_edges = std::collections::HashMap::new();
    for edge in before {
        old_edges.insert(edge_key(&edge.from, &edge.to), edge);
    }
    let mut new_edges = std::collections::HashMap::new();
    for edge in after {
        new_edges.insert(edge_key(&edge.from, &edge.to), edge);
    }
    for (key, edge) in &new_edges {
        if !old_edges.contains_key(key) {
            acc.added.push(DiffItem {
                kind: "edge".to_string(),
                id: key.clone(),
                detail: edge.label.clone().unwrap_or_default(),
            });
        }
    }
    for (key, edge) in &old_edges {
        if !new_edges.contains_key(key) {
            acc.removed.push(DiffItem {
                kind: "edge".to_string(),
                id: key.clone(),
                detail: edge.label.clone().unwrap_or_default(),
            });
        }
    }
    for (key, edge) in &new_edges {
        let Some(prev) = old_edges.get(key) else {
            continue;
        };
        if prev.label != edge.label {
            acc.modified.push(DiffItem {
                kind: "edge".to_string(),
                id: key.clone(),
                detail: format!(
                    "label \"{}\" → \"{}\"",
                    prev.label.as_deref().unwrap_or(""),
                    edge.label.as_deref().unwrap_or("")
                ),
            });
        }
    }
}

fn diff_er(before: &ErSpec, after: &ErSpec, acc: &mut DiffAcc) {
    let mut old_entities = std::collections::HashMap::new();
    for entity in &before.entities {
        old_entities.insert(entity.name.clone(), entity);
    }
    let mut new_entities = std::collections::HashMap::new();
    for entity in &after.entities {
        new_entities.insert(entity.name.clone(), entity);
    }
    for name in new_entities.keys() {
        if !old_entities.contains_key(name) {
            acc.added.push(DiffItem {
                kind: "entity".to_string(),
                id: name.clone(),
                detail: String::new(),
            });
        }
    }
    for name in old_entities.keys() {
        if !new_entities.contains_key(name) {
            acc.removed.push(DiffItem {
                kind: "entity".to_string(),
                id: name.clone(),
                detail: String::new(),
            });
        }
    }
    for (name, entity) in &new_entities {
        let Some(prev) = old_entities.get(name) else {
            continue;
        };
        if joined(&prev.requirements) != joined(&entity.requirements) {
            acc.modified.push(DiffItem {
                kind: "entity".to_string(),
                id: name.clone(),
                detail: format!(
                    "requirements [{}] → [{}]",
                    joined(&prev.requirements),
                    joined(&entity.requirements)
                ),
            });
        }
        if joined(&prev.mockups) != joined(&entity.mockups) {
            acc.modified.push(DiffItem {
                kind: "entity".to_string(),
                id: name.clone(),
                detail: format!(
                    "mockups [{}] → [{}]",
                    joined(&prev.mockups),
                    joined(&entity.mockups)
                ),
            });
        }
        diff_attributes(name, &prev.attributes, &entity.attributes, acc);
    }
    diff_relations(&before.relations, &after.relations, acc);
}

fn diff_attributes(entity: &str, before: &[ErAttribute], after: &[ErAttribute], acc: &mut DiffAcc) {
    let mut old_attrs = std::collections::HashMap::new();
    for attr in before {
        old_attrs.insert(attr.name.clone(), attr);
    }
    let mut new_attrs = std::collections::HashMap::new();
    for attr in after {
        new_attrs.insert(attr.name.clone(), attr);
    }
    for name in new_attrs.keys() {
        if !old_attrs.contains_key(name) {
            acc.added.push(DiffItem {
                kind: "attribute".to_string(),
                id: format!("{entity}.{name}"),
                detail: String::new(),
            });
        }
    }
    for name in old_attrs.keys() {
        if !new_attrs.contains_key(name) {
            acc.removed.push(DiffItem {
                kind: "attribute".to_string(),
                id: format!("{entity}.{name}"),
                detail: String::new(),
            });
        }
    }
    for (name, attr) in &new_attrs {
        let Some(prev) = old_attrs.get(name) else {
            continue;
        };
        if prev.key != attr.key {
            acc.modified.push(DiffItem {
                kind: "attribute".to_string(),
                id: format!("{entity}.{name}"),
                detail: format!("key {} → {}", prev.key, attr.key),
            });
        }
    }
}

fn diff_relations(before: &[ErRelation], after: &[ErRelation], acc: &mut DiffAcc) {
    let mut old_relations = std::collections::HashMap::new();
    for relation in before {
        old_relations.insert(edge_key(&relation.from, &relation.to), relation);
    }
    let mut new_relations = std::collections::HashMap::new();
    for relation in after {
        new_relations.insert(edge_key(&relation.from, &relation.to), relation);
    }
    for (key, relation) in &new_relations {
        if !old_relations.contains_key(key) {
            acc.added.push(DiffItem {
                kind: "relation".to_string(),
                id: key.clone(),
                detail: relation.label.clone().unwrap_or_default(),
            });
        }
    }
    for (key, relation) in &old_relations {
        if !new_relations.contains_key(key) {
            acc.removed.push(DiffItem {
                kind: "relation".to_string(),
                id: key.clone(),
                detail: relation.label.clone().unwrap_or_default(),
            });
        }
    }
    for (key, relation) in &new_relations {
        let Some(prev) = old_relations.get(key) else {
            continue;
        };
        let mut changes = Vec::new();
        if prev.label != relation.label {
            changes.push(format!(
                "label \"{}\" → \"{}\"",
                prev.label.as_deref().unwrap_or(""),
                relation.label.as_deref().unwrap_or("")
            ));
        }
        if prev.from_card != relation.from_card {
            changes.push(format!(
                "from_card {:?} → {:?}",
                prev.from_card, relation.from_card
            ));
        }
        if prev.to_card != relation.to_card {
            changes.push(format!(
                "to_card {:?} → {:?}",
                prev.to_card, relation.to_card
            ));
        }
        if !changes.is_empty() {
            acc.modified.push(DiffItem {
                kind: "relation".to_string(),
                id: key.clone(),
                detail: changes.join("; "),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generation::GenerationContextItem;

    const SECRET: &str = "sk-test";

    fn allowed() -> Vec<String> {
        vec!["req-3".to_string(), "req-5".to_string()]
    }

    fn envelope_text(fixture: &str) -> String {
        crate::protocol::parse_success_capped(200, fixture, SECRET, DESIGN_MAX_BODY_BYTES)
            .expect("valid envelope")
            .text
    }

    #[test]
    fn nodes_and_entities_cite_mockups_inside_sent_set() {
        let flow = serde_json::json!({
            "title": "F", "explanation": "E", "questions": [],
            "nodes": [
                {"id": "a", "kind": "start", "label": "A",
                 "requirements": ["req-3"], "mockups": ["mockup-1/f_name"]},
                {"id": "b", "kind": "end", "label": "B",
                 "requirements": [], "mockups": []}
            ],
            "edges": [{"from": "a", "to": "b"}]
        })
        .to_string();
        let allowed = vec!["req-3".to_string(), "mockup-1".to_string()];
        let design = parse_design_output(&flow, DesignKind::Flow, &allowed).expect("citations");
        assert_eq!(
            design.flow.as_ref().expect("flow").nodes[0].mockups,
            vec!["mockup-1/f_name".to_string()]
        );
        assert!(design.flow.as_ref().expect("flow").nodes[1]
            .mockups
            .is_empty());
        let canonical = canonical_json(&design);
        assert!(
            canonical.contains("\"mockups\":[\"mockup-1/f_name\"]"),
            "{canonical}"
        );
        // Empty ones are omitted: earlier designs' canonical form is unchanged.
        assert_eq!(canonical.matches("\"mockups\"").count(), 1);

        let er = serde_json::json!({
            "title": "M", "explanation": "E", "questions": [],
            "entities": [
                {"name": "Venta", "attributes": [{"name": "id", "key": true}],
                 "requirements": ["req-3"], "mockups": ["mockup-1/tb"]}
            ],
            "relations": []
        })
        .to_string();
        let design = parse_design_output(&er, DesignKind::DataModel, &allowed).expect("entity");
        assert_eq!(
            design.er.as_ref().expect("model").entities[0].mockups,
            vec!["mockup-1/tb".to_string()]
        );
    }

    #[test]
    fn mockup_citations_reject_bad_shape_and_outside_set() {
        let bad = serde_json::json!({
            "title": "F", "explanation": "E", "questions": [],
            "nodes": [
                {"id": "a", "kind": "start", "label": "A",
                 "requirements": ["req-3"], "mockups": ["no-slash"]}
            ],
            "edges": []
        })
        .to_string();
        let allowed = vec!["req-3".to_string(), "mockup-1".to_string()];
        let err = parse_design_output(&bad, DesignKind::Flow, &allowed).expect_err("shape");
        assert!(err.message.contains("mockup/component"), "{}", err.message);
        let outside = serde_json::json!({
            "title": "F", "explanation": "E", "questions": [],
            "nodes": [
                {"id": "a", "kind": "start", "label": "A",
                 "requirements": ["req-3"], "mockups": ["mockup-9/x"]}
            ],
            "edges": []
        })
        .to_string();
        parse_design_output(&outside, DesignKind::Flow, &allowed).expect_err("outside");
        let dup = serde_json::json!({
            "title": "F", "explanation": "E", "questions": [],
            "nodes": [
                {"id": "a", "kind": "start", "label": "A",
                 "requirements": ["req-3"],
                 "mockups": ["mockup-1/x", "mockup-1/x"]}
            ],
            "edges": []
        })
        .to_string();
        parse_design_output(&dup, DesignKind::Flow, &allowed).expect_err("duplicate");
    }

    #[test]
    fn mockup_template_cites_motivation_and_justifies_tech_attributes() {
        let input = build_mockup_design_input(
            DesignKind::DataModel,
            &[GenerationContextItem {
                artifact_id: "req-3".to_string(),
                version_id: "req-3-v1".to_string(),
                content: "vender".to_string(),
            }],
            &[],
        );
        assert!(input.contains("mockup/component"), "{input}");
        assert!(input.contains("is NOT an entity"), "{input}");
        assert!(input.contains("never by default"), "{input}");
        let update = build_update_input(DesignKind::DataModel, "{}", &[], None, &[]);
        assert!(update.contains("do not delete them"), "{update}");
        let flow = build_mockup_design_input(DesignKind::Flow, &[], &[]);
        assert!(flow.contains("mockup/component"), "{flow}");
        assert_eq!(DESIGN_MOCKUP_TEMPLATE_VERSION, 3);
        assert_eq!(DESIGN_UPDATE_TEMPLATE_VERSION, 3);
    }

    #[test]
    fn parses_valid_flow_fixture_and_renders_mermaid() {
        let body = include_str!("../tests/fixtures/design_flow_completed.json");
        let design =
            parse_design_output(&envelope_text(body), DesignKind::Flow, &allowed()).expect("valid");
        assert_eq!(design.title, "Confirm sale with stock");
        let flow = design.flow.as_ref().expect("flow");
        assert_eq!(flow.nodes.len(), 4);
        assert_eq!(flow.edges.len(), 4);
        assert_eq!(design.questions.len(), 1);
        // The decision→review cycle is valid in an operation flow.
        assert!(flow
            .edges
            .iter()
            .any(|e| e.from == "decision" && e.to == "review"));
        let mermaid = to_mermaid(&design);
        let expected = "flowchart TD\n\
             \x20   start([\"Sale created\"])\n\
             \x20   review[\"Review available stock\"]\n\
             \x20   decision{\"Is there enough stock?\"}\n\
             \x20   end([\"Sale confirmed\"])\n\
             \x20   start --> review\n\
             \x20   review --> decision\n\
             \x20   decision -- \"yes\" --> end\n\
             \x20   decision -- \"no\" --> review\n";
        assert_eq!(mermaid, expected);
        // Deterministic: identical second serialization.
        assert_eq!(to_mermaid(&design), expected);
    }

    #[test]
    fn parses_valid_er_fixture_and_renders_mermaid() {
        let body = include_str!("../tests/fixtures/design_er_completed.json");
        let design = parse_design_output(&envelope_text(body), DesignKind::DataModel, &allowed())
            .expect("valid");
        assert_eq!(design.title, "Sales and stock");
        let er = design.er.as_ref().expect("model");
        assert_eq!(er.entities.len(), 2);
        assert_eq!(er.relations.len(), 1);
        let mermaid = to_mermaid(&design);
        let expected = "erDiagram\n\
             \x20   SALE {\n\
             \x20       string id PK\n\
             \x20       string status\n\
             \x20   }\n\
             \x20   LINE {\n\
             \x20       string id PK\n\
             \x20       string quantity\n\
             \x20   }\n\
             \x20   SALE ||--}| LINE : \"contains\"\n";
        assert_eq!(mermaid, expected);
    }

    #[test]
    fn er_relations_always_carry_a_quoted_label() {
        // Regression: erDiagram requires `: label` and Mermaid 12 fails
        // with `Expecting COLON` when missing; multi-word requires quotes.
        let text = serde_json::json!({
            "title": "Ventas",
            "entities": [
                {"name": "A", "attributes": [{"name": "id", "key": true}], "requirements": []},
                {"name": "B", "attributes": [{"name": "id", "key": true}], "requirements": []},
                {"name": "C", "attributes": [{"name": "id", "key": true}], "requirements": []}
            ],
            "relations": [
                {"from": "A", "to": "B", "from_card": "1", "to_card": "N"},
                {"from": "B", "to": "C", "label": "se compone de varias", "from_card": "1", "to_card": "0..N"},
                {"from": "A", "to": "C", "label": "%%{init}x</script>", "from_card": "1", "to_card": "1"}
            ],
            "explanation": "E.",
            "questions": []
        })
        .to_string();
        let design = parse_design_output(&text, DesignKind::DataModel, &[]).expect("valid");
        let mermaid = to_mermaid(&design);
        let relations: Vec<&str> = mermaid.lines().filter(|line| line.contains("--")).collect();
        assert_eq!(relations.len(), 3);
        for line in &relations {
            assert!(
                line.contains(" : \"") && line.ends_with('"'),
                "relation without a quoted label: {line}"
            );
        }
        assert!(mermaid.contains("A ||--}| B : \"rel\""));
        assert!(mermaid.contains("B ||--}o C : \"se compone de varias\""));
        // Hostile input neutralized but label present.
        assert!(!mermaid.contains('%') && !mermaid.contains('<'));
    }

    #[test]
    fn canonical_json_roundtrips() {
        let body = include_str!("../tests/fixtures/design_flow_completed.json");
        let design =
            parse_design_output(&envelope_text(body), DesignKind::Flow, &allowed()).expect("valid");
        let canonical = canonical_json(&design);
        let again =
            parse_design_output(&canonical, DesignKind::Flow, &allowed()).expect("canonical");
        assert_eq!(again, design);
        assert_eq!(canonical_json(&again), canonical);
    }

    #[test]
    fn malicious_labels_are_escaped() {
        let text = serde_json::json!({
            "title": "T",
            "nodes": [
                {"id": "n1", "kind": "step", "label": "\"><script>alert(1)</script>", "requirements": []},
                {"id": "n2", "kind": "end", "label": "%%{init} -- click n1 href \"http://x\"", "requirements": []}
            ],
            "edges": [{"from": "n1", "to": "n2", "label": "[a](http://evil)"}],
            "explanation": "E",
            "questions": []
        })
        .to_string();
        // Labels are accepted as capped free text: it is the serializer
        // that neutralizes them when deriving Mermaid.
        let design = parse_design_output(&text, DesignKind::Flow, &[]).expect("passes validation");
        let mermaid = to_mermaid(&design);
        // No HTML tags, directives, URLs or link syntax: (`>` only
        // survives in the structural `-->` arrows.)
        assert!(!mermaid.contains('<'), "{mermaid}");
        assert!(!mermaid.contains("%%"), "{mermaid}");
        assert!(!mermaid.contains("http://"), "{mermaid}");
        assert!(!mermaid.contains("]("), "{mermaid}");
    }

    #[test]
    fn rejects_duplicate_ids_dangling_edges_and_bad_cards() {
        // Duplicate nodes.
        let dup = serde_json::json!({
            "title": "T",
            "nodes": [
                {"id": "n", "kind": "step", "label": "A", "requirements": []},
                {"id": "n", "kind": "step", "label": "B", "requirements": []}
            ],
            "edges": [], "explanation": "E", "questions": []
        })
        .to_string();
        assert!(parse_design_output(&dup, DesignKind::Flow, &[]).is_err());
        // Edge to a missing node.
        let dangling = serde_json::json!({
            "title": "T",
            "nodes": [{"id": "n", "kind": "step", "label": "A", "requirements": []}],
            "edges": [{"from": "n", "to": "ghost"}],
            "explanation": "E", "questions": []
        })
        .to_string();
        let err = parse_design_output(&dangling, DesignKind::Flow, &[]).expect_err("dangling");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Disallowed cardinality.
        let card = serde_json::json!({
            "title": "T",
            "entities": [
                {"name": "A", "attributes": [{"name": "id", "key": true}], "requirements": []},
                {"name": "B", "attributes": [{"name": "id", "key": true}], "requirements": []}
            ],
            "relations": [{"from": "A", "to": "B", "from_card": "1", "to_card": "many"}],
            "explanation": "E", "questions": []
        })
        .to_string();
        assert!(parse_design_output(&card, DesignKind::DataModel, &[]).is_err());
    }

    #[test]
    fn references_must_belong_to_sent_set() {
        let text = serde_json::json!({
            "title": "T",
            "nodes": [{"id": "n", "kind": "step", "label": "A", "requirements": ["req-3"]}],
            "edges": [], "explanation": "E", "questions": []
        })
        .to_string();
        assert!(parse_design_output(&text, DesignKind::Flow, &allowed()).is_ok());
        let err = parse_design_output(&text, DesignKind::Flow, &["req-9".to_string()])
            .expect_err("foreign");
        assert!(err.message.contains("outside the sent set"));
    }

    #[test]
    fn rejects_over_limits_and_wrong_kind() {
        let nodes: Vec<_> = (0..25)
            .map(|i| {
                serde_json::json!({"id": format!("n{i}"), "kind": "step", "label": "A", "requirements": []})
            })
            .collect();
        let text = serde_json::json!({
            "title": "T", "nodes": nodes, "edges": [], "explanation": "E", "questions": []
        })
        .to_string();
        assert!(parse_design_output(&text, DesignKind::Flow, &[]).is_err());
        // ER requested but flow received.
        let flow = serde_json::json!({
            "title": "T",
            "nodes": [{"id": "n", "kind": "step", "label": "A", "requirements": []}],
            "edges": [], "explanation": "E", "questions": []
        })
        .to_string();
        assert!(parse_design_output(&flow, DesignKind::DataModel, &[]).is_err());
        assert_eq!(DesignKind::parse("flow"), Ok(DesignKind::Flow));
        assert_eq!(DesignKind::parse("data_model"), Ok(DesignKind::DataModel));
        assert!(DesignKind::parse("uml").is_err());
    }

    #[test]
    fn design_body_uses_text_format_with_kind_schema() {
        for (kind, name, key) in [
            (DesignKind::Flow, "operation_flow", "nodes"),
            (DesignKind::DataModel, "er_model", "entities"),
        ] {
            let body = build_design_body(kind, "muse-spark-1.3", "input");
            assert_eq!(body["max_output_tokens"], DESIGN_MAX_OUTPUT_TOKENS);
            let format = &body["text"]["format"];
            assert_eq!(format["type"], "json_schema");
            assert_eq!(format["name"], name);
            assert!(format["schema"]["properties"][key].is_object());
        }
    }

    #[test]
    fn design_input_renders_saved_context_with_caps() {
        let items: Vec<GenerationContextItem> = (0..25)
            .map(|i| GenerationContextItem {
                artifact_id: format!("req-{i:02}"),
                version_id: format!("req-{i:02}-v1"),
                content: "Contenido aprobado.".to_string(),
            })
            .collect();
        let input = build_design_input(DesignKind::Flow, &items);
        assert!(input.contains("[req-00 @ req-00-v1]"));
        assert!(!input.contains("[req-20 @ req-20-v1]"));
        assert!(input.chars().count() <= MAX_DESIGN_INPUT_CHARS);
    }

    fn flow_spec(text: &str) -> ValidatedDesign {
        parse_design_output(text, DesignKind::Flow, &allowed()).expect("valid flow")
    }

    fn er_spec(text: &str) -> ValidatedDesign {
        parse_design_output(text, DesignKind::DataModel, &allowed()).expect("valid ER")
    }

    #[test]
    fn update_input_carries_current_spec_sources_origin_and_paths() {
        let sources = vec![UpdateSource {
            artifact_id: "req-3".to_string(),
            used_version_id: "req-3-v1".to_string(),
            used_content: "Descuenta stock al confirmar.".to_string(),
            current_version_id: "req-3-v2".to_string(),
            current_content: "Reserva antes de confirmar.".to_string(),
        }];
        let origin = OriginChange {
            artifact_id: "req-3".to_string(),
            from_version_id: "req-3-v1".to_string(),
            from_content: "Descuenta stock al confirmar.".to_string(),
            current_version_id: "req-3-v2".to_string(),
            current_content: "Reserva antes de confirmar.".to_string(),
        };
        let input = build_update_input(
            DesignKind::Flow,
            "{\"title\":\"Flujo\"}",
            &sources,
            Some(&origin),
            &[vec!["req-3".to_string(), "flujo-4".to_string()]],
        );
        assert!(input.contains("PROPOSING ADJUSTMENTS"));
        assert!(input.contains("{\"title\":\"Flujo\"}"));
        assert!(input.contains("used req-3-v1"));
        assert!(input.contains("current req-3-v2"));
        assert!(input.contains("Reserva antes de confirmar."));
        assert!(input.contains("req-3 → flujo-4"));
        assert!(input.chars().count() <= MAX_DESIGN_INPUT_CHARS);
    }

    #[test]
    fn update_input_marks_unchanged_sources_and_caps_size() {
        let sources: Vec<UpdateSource> = (0..25)
            .map(|i| UpdateSource {
                artifact_id: format!("req-{i:02}"),
                used_version_id: format!("req-{i:02}-v1"),
                used_content: "Same.".to_string(),
                current_version_id: format!("req-{i:02}-v1"),
                current_content: "Same.".to_string(),
            })
            .collect();
        let big_spec = format!("{{\"title\":\"{}\"}}", "x".repeat(MAX_DESIGN_INPUT_CHARS));
        let input = build_update_input(DesignKind::DataModel, &big_spec, &sources, None, &[]);
        assert!(input.contains("(unchanged)"));
        assert!(!input.contains("[req-20 @"));
        assert!(input.chars().count() <= MAX_DESIGN_INPUT_CHARS);
    }

    #[test]
    fn diff_flow_reports_added_removed_and_modified() {
        let old = flow_spec(
            &serde_json::json!({
                "title": "Venta",
                "nodes": [
                    {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": ["req-3"]},
                    {"id": "fin", "kind": "end", "label": "Venta confirmada", "requirements": []}
                ],
                "edges": [{"from": "inicio", "to": "fin"}],
                "explanation": "Before.",
                "questions": []
            })
            .to_string(),
        );
        let new = flow_spec(
            &serde_json::json!({
                "title": "Venta con reserva",
                "nodes": [
                    {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": ["req-3"]},
                    {"id": "reserva", "kind": "step", "label": "Reservar stock", "requirements": ["req-3"]},
                    {"id": "fin", "kind": "end", "label": "Venta cerrada", "requirements": []}
                ],
                "edges": [
                    {"from": "inicio", "to": "reserva"},
                    {"from": "reserva", "to": "fin"}
                ],
                "explanation": "After.",
                "questions": []
            })
            .to_string(),
        );
        let diff = diff_designs(&old, &new).expect("diff");
        let kinds: Vec<(&str, &str)> = diff
            .added
            .iter()
            .map(|i| ("added", i.id.as_str()))
            .chain(diff.removed.iter().map(|i| ("removed", i.id.as_str())))
            .chain(diff.modified.iter().map(|i| ("modified", i.id.as_str())))
            .collect();
        assert!(kinds.contains(&("added", "reserva")));
        assert!(kinds.contains(&("added", "inicio → reserva")));
        assert!(kinds.contains(&("removed", "inicio → fin")));
        assert!(kinds.contains(&("modified", "title")));
        assert!(kinds.contains(&("modified", "fin")));
        let fin = diff.modified.iter().find(|i| i.id == "fin").expect("end");
        assert!(fin.detail.contains("Venta confirmada"));
        assert!(fin.detail.contains("Venta cerrada"));
        // Deterministic: same order on each computation.
        assert_eq!(diff, diff_designs(&old, &new).expect("diff"));
    }

    #[test]
    fn diff_er_covers_entities_attributes_and_relations() {
        let old = er_spec(
            &serde_json::json!({
                "title": "Ventas",
                "entities": [
                    {"name": "venta", "attributes": [{"name": "id", "key": true}], "requirements": ["req-3"]}
                ],
                "relations": [],
                "explanation": "Before.",
                "questions": []
            })
            .to_string(),
        );
        let new = er_spec(
            &serde_json::json!({
                "title": "Ventas",
                "entities": [
                    {"name": "venta", "attributes": [{"name": "id", "key": true}, {"name": "estado", "key": false}], "requirements": ["req-3"]},
                    {"name": "reserva", "attributes": [{"name": "id", "key": true}], "requirements": ["req-3"]}
                ],
                "relations": [{"from": "venta", "to": "reserva", "from_card": "1", "to_card": "0..N"}],
                "explanation": "After.",
                "questions": []
            })
            .to_string(),
        );
        let diff = diff_designs(&old, &new).expect("diff");
        let added: Vec<&str> = diff.added.iter().map(|i| i.id.as_str()).collect();
        assert!(added.contains(&"reserva"));
        assert!(added.contains(&"venta.estado"));
        assert!(added.contains(&"venta → reserva"));
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn diff_rejects_mixed_kinds_and_flags_renames_as_add_remove() {
        let flow = flow_spec(
            &serde_json::json!({
                "title": "Venta",
                "nodes": [{"id": "a", "kind": "start", "label": "A", "requirements": []}],
                "edges": [],
                "explanation": "E.",
                "questions": []
            })
            .to_string(),
        );
        let renamed = flow_spec(
            &serde_json::json!({
                "title": "Venta",
                "nodes": [{"id": "b", "kind": "start", "label": "A", "requirements": []}],
                "edges": [],
                "explanation": "E.",
                "questions": []
            })
            .to_string(),
        );
        let diff = diff_designs(&flow, &renamed).expect("diff");
        assert_eq!(
            diff.added.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["b"]
        );
        assert_eq!(
            diff.removed
                .iter()
                .map(|i| i.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a"]
        );
        assert!(diff.modified.is_empty());
        let er = er_spec(
            &serde_json::json!({
                "title": "Ventas",
                "entities": [{"name": "venta", "attributes": [{"name": "id", "key": true}], "requirements": []}],
                "relations": [],
                "explanation": "E.",
                "questions": []
            })
            .to_string(),
        );
        assert!(diff_designs(&flow, &er).is_err());
    }
}
