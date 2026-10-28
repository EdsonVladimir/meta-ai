//! Generación asistida de diseño vinculado a requisitos (hito 6).
//!
//! Misma modalidad que `generation`: Responses API con `text.format`
//! (`type: "json_schema"`) y validación autoritativa en Rust. Cada llamada
//! genera UNA propuesta de flujo de operación o de modelo entidad-relación
//! a partir de requisitos seleccionados (versiones guardadas).
//!
//! ## Subconjunto inicial (documentado, no es un modelador UML universal)
//!
//! Flujo: nodos con identidad (`[A-Za-z0-9_]`), tipo (`start`, `step`,
//! `decision`, `end`), etiqueta y requisitos referenciados; aristas con
//! origen, destino y etiqueta opcional. Los ciclos en el flujo son válidos
//! (un bucle de operación no es un ciclo de dependencias del núcleo).
//!
//! ER: entidades con nombre (`[A-Za-z0-9_]`), atributos (nombre + marca de
//! clave, SIN tipos: fuera del subconjunto) y requisitos referenciados;
//! relaciones con extremos, etiqueta opcional y cardinalidades del conjunto
//! `1`, `0..1`, `N`, `0..N`.
//!
//! Las referencias a requisitos usan identificadores de ARTEFACTO (`req-3`),
//! estables ante nuevas versiones; las versiones exactas utilizadas se
//! registran aparte, a nivel de generación. Toda referencia debe pertenecer
//! al conjunto enviado: lo demás se rechaza.
//!
//! El JSON canónico es el contenido autoritativo; Mermaid se deriva con
//! `to_mermaid` (determinista, con etiquetas escapadas: el modelo no puede
//! introducir HTML, scripts, directivas ni enlaces).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{redact, MetaError, MetaErrorKind};
use crate::protocol::{classify_transport, parse_error, parse_success_capped, TokenUsage};

/// Versión de la plantilla de instrucciones de diseño. La v2 (diseño vivo)
/// deja de hablar de requisitos «aprobados»: genera desde versiones
/// guardadas y pide señalar ambigüedades sin inventar decisiones.
pub const DESIGN_TEMPLATE_VERSION: u32 = 2;
/// Límites de entrada (el contexto lo filtra `ruth-api` al módulo activo).
pub const MAX_DESIGN_CONTEXT_ITEMS: usize = 20;
pub const MAX_DESIGN_CONTEXT_CONTENT_CHARS: usize = 2000;
pub const MAX_DESIGN_INPUT_CHARS: usize = 50_000;
/// Límites de salida por campo y cantidad.
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
/// Límite de salida, timeout y tope de cuerpo (como en requisitos).
pub const DESIGN_MAX_OUTPUT_TOKENS: u32 = 4096;
pub const DESIGN_TIMEOUT_SECS: u64 = 90;
pub const DESIGN_MAX_BODY_BYTES: usize = 262_144;

/// Tipo de diseño pedido y validado. Coincide con `ArtifactType` del núcleo
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
                format!("tipo de diseño desconocido: {other}"),
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

/// Tipo de nodo del subconjunto inicial de flujos.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlowNodeKind {
    Start,
    Step,
    Decision,
    End,
}

/// Cardinalidad del subconjunto inicial de ER.
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

/// Propuesta validada, lista para registrar. El contenido autoritativo es
/// `canonical_json`; Mermaid se deriva y nunca se almacena como fuente.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedDesign {
    pub title: String,
    pub kind: DesignKind,
    pub flow: Option<FlowSpec>,
    pub er: Option<ErSpec>,
    pub explanation: String,
    pub questions: Vec<String>,
}

/// Resultado completo con metadatos de la llamada (modelo y uso, si los da).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesignResult {
    pub design: ValidatedDesign,
    pub model: String,
    pub usage: Option<TokenUsage>,
}

const FLOW_INSTRUCTION: &str = "Eres un diseñador que propone un flujo de operación a partir de requisitos (versiones guardadas). \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Propón UN flujo: title, nodes (al menos uno; cada uno con id único de letras, dígitos y subrayado, kind entre start, step, decision y end, label y requirements con identificadores de los requisitos enviados), \
edges (origen y destino existentes, label opcional), explanation breve y questions (como mucho 5, vacía si no hay). \
Señala ambigüedades en questions y no inventes decisiones como aprobadas.";

const ER_INSTRUCTION: &str = "Eres un diseñador que propone un modelo entidad-relación a partir de requisitos (versiones guardadas). \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Propón UN modelo: title, entities (al menos una; cada una con name único de letras, dígitos y subrayado, attributes con al menos un atributo de name y key, y requirements con identificadores de los requisitos enviados), \
relations (extremos existentes, label opcional, from_card y to_card entre 1, 0..1, N y 0..N), explanation breve y questions (como mucho 5, vacía si no hay). \
No propongas tipos de atributos: están fuera del subconjunto. \
Señala ambigüedades en questions y no inventes decisiones como aprobadas.";

/// Monta el texto enviado al modelo. El contexto ya llega filtrado a
/// requisitos seleccionados del módulo; aquí solo se aplican topes.
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
            "{instruction}\n\nRequisitos seleccionados — versiones guardadas (contexto; {}):\n{}",
            rendered.len(),
            rendered.join("\n\n")
        );
        if input.chars().count() <= MAX_DESIGN_INPUT_CHARS || rendered.is_empty() {
            return input;
        }
        rendered.pop();
    }
}

/// Versión de la plantilla de diseño desde mockups (etapa B): el mismo
/// esquema de salida, con instrucciones que leen pantallas y componentes.
pub const DESIGN_MOCKUP_TEMPLATE_VERSION: u32 = 1;

const FLOW_FROM_MOCKUP_INSTRUCTION: &str = "Eres un diseñador que propone un flujo de operación a partir de mockups y requisitos (versiones guardadas). \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Lee las pantallas y sus componentes (textos, campos con su origen declarado, selectores, botones con acción o destino, tablas) y deduce los pasos y decisiones del flujo; relaciona cada elemento con los requisitos enviados cuando corresponda. \
Propón UN flujo: title, nodes (al menos uno; cada uno con id único de letras, dígitos y subrayado, kind entre start, step, decision y end, label y requirements con identificadores del contexto enviado), \
edges (origen y destino existentes, label opcional), explanation breve (incluye qué campos o acciones del mockup motivan cada parte) y questions (como mucho 5, vacía si no hay). \
Si algún dato falta (por ejemplo, generas solo desde mockups sin requisitos), dilo en questions: no inventes reglas, aprobaciones ni certezas. \
Conserva en explanation los elementos que la persona deba revisar a mano.";

const ER_FROM_MOCKUP_INSTRUCTION: &str = "Eres un diseñador que propone un modelo entidad-relación a partir de mockups y requisitos (versiones guardadas). \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Lee las pantallas y sus componentes; los campos y tablas con origen persisted sugieren datos guardados, mientras que calculated, temporary, external o undefined NO implican columnas: si los reflejas, explícalo como supuesto. \
Propón UN modelo: title, entities (al menos una; cada una con name único de letras, dígitos y subrayado, attributes con al menos un atributo de name y key, y requirements con identificadores del contexto enviado), \
relations (extremos existentes, label opcional, from_card y to_card entre 1, 0..1, N y 0..N), explanation breve (incluye qué campos o tablas del mockup motivan cada entidad) y questions (como mucho 5, vacía si no hay). \
No propongas tipos de atributos: están fuera del subconjunto. \
Si algún dato falta (por ejemplo, generas solo desde mockups sin requisitos), dilo en questions: no inventes reglas, aprobaciones ni certezas.";

/// Monta el texto para proponer un diseño desde mockups y requisitos
/// guardados. Los mockups viajan como resumen legible (sin posiciones);
/// al menos un elemento de contexto es obligatorio y se aplican los
/// mismos topes que en la creación desde requisitos.
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
            "{instruction}\n\nContexto guardado — {} requisitos, {} mockups:\n{}",
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

/// Esquema JSON enviado en `text.format` para el tipo pedido.
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
    for (key, value) in spec.as_object().expect("objeto") {
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

/// Cuerpo de la petición de diseño.
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

/// Valida el texto del modelo como propuesta de diseño del tipo pedido.
/// `allowed` son los identificadores de artefacto enviados como contexto:
/// toda referencia debe pertenecer al conjunto. Rechaza sin crear nada
/// ante JSON ausente, tipo ausente o erróneo, campos inválidos, ids
/// duplicados, referencias inexistentes o cardinalidades no admitidas.
pub fn parse_design_output(
    text: &str,
    kind: DesignKind,
    allowed: &[String],
) -> Result<ValidatedDesign, MetaError> {
    let json = crate::generation::extract_json(text).ok_or_else(|| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "La API devolvió un diseño que no es JSON válido.",
            false,
        )
    })?;
    let title = string_field(&json, "title")
        .and_then(|t| non_empty(&t, MAX_DESIGN_TITLE_CHARS))
        .ok_or_else(|| invalid("diseño sin título válido"))?;
    let explanation = string_field(&json, "explanation")
        .and_then(|t| non_empty(&t, MAX_DESIGN_EXPLANATION_CHARS))
        .ok_or_else(|| invalid("diseño sin explicación válida"))?;
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

/// Revalida una especificación editada (JSON ya parseado) contra el tipo y
/// el conjunto permitido. Misma validación que la salida del modelo.
pub fn validate_design_value(
    kind: DesignKind,
    value: &serde_json::Value,
    allowed: &[String],
) -> Result<ValidatedDesign, MetaError> {
    let text =
        serde_json::to_string(value).map_err(|_| invalid("especificación no serializable"))?;
    parse_design_output(&text, kind, allowed)
}

/// Contenido autoritativo canónico: serialización fija de lo validado.
/// Es lo que se guarda en la versión al aceptar; Mermaid se deriva de aquí.
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
    serde_json::to_string(&map).expect("lo validado serializa")
}

/// Serializa lo validado a Mermaid de forma determinista. Las etiquetas se
/// escapan (sin comillas, directivas ni HTML posibles) y los identificadores
/// ya vienen restringidos por validación: el modelo no puede inyectar nada.
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
            // Sin tipos en el subconjunto inicial: tipo fijo `string`.
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
        // erDiagram exige `: etiqueta` en cada relación: sin ella Mermaid
        // no compila (`Expecting COLON`). Se entrecomilla (puede tener
        // espacios) y `rel` cubre la ausencia; el escape ya eliminó
        // comillas, directivas e inyecciones.
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

/// Escapa una etiqueta para Mermaid: fuera comillas, directivas (`%%`),
/// HTML y caracteres con significado en diagramas. Determinista.
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
        .ok_or_else(|| invalid("flujo sin lista de nodos"))?;
    if nodes.is_empty() || nodes.len() > MAX_FLOW_NODES {
        return Err(invalid(format!(
            "el flujo debe tener entre 1 y {MAX_FLOW_NODES} nodos"
        )));
    }
    let edges = json
        .get("edges")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("flujo sin lista de aristas"))?;
    if edges.len() > MAX_FLOW_EDGES {
        return Err(invalid(format!(
            "demasiadas aristas: {} (máximo {MAX_FLOW_EDGES})",
            edges.len()
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out_nodes = Vec::with_capacity(nodes.len());
    for (i, node) in nodes.iter().enumerate() {
        let n = i + 1;
        let id = string_field(node, "id")
            .filter(|id| valid_id(id))
            .ok_or_else(|| invalid(format!("nodo {n}: identificador inválido")))?;
        if !seen.insert(id.clone()) {
            return Err(invalid(format!("nodo {n}: identificador duplicado")));
        }
        let kind: FlowNodeKind = node
            .get("kind")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| invalid(format!("nodo {n}: tipo inválido")))?;
        let label = string_field(node, "label")
            .and_then(|t| non_empty(&t, MAX_DESIGN_LABEL_CHARS))
            .ok_or_else(|| invalid(format!("nodo {n}: etiqueta vacía o excesiva")))?;
        let requirements = ref_items(node, "requirements", n, allowed, "nodo")?;
        out_nodes.push(FlowNode {
            id,
            kind,
            label,
            requirements,
        });
    }
    let mut out_edges = Vec::with_capacity(edges.len());
    for (i, edge) in edges.iter().enumerate() {
        let n = i + 1;
        let from =
            string_field(edge, "from").ok_or_else(|| invalid(format!("arista {n}: sin origen")))?;
        let to =
            string_field(edge, "to").ok_or_else(|| invalid(format!("arista {n}: sin destino")))?;
        if !seen.contains(&from) {
            return Err(invalid(format!("arista {n}: origen inexistente")));
        }
        if !seen.contains(&to) {
            return Err(invalid(format!("arista {n}: destino inexistente")));
        }
        let label = match edge.get("label") {
            None | Some(serde_json::Value::Null) => None,
            Some(value) => {
                let text = value
                    .as_str()
                    .ok_or_else(|| invalid(format!("arista {n}: etiqueta no textual")))?;
                Some(
                    non_empty(text, MAX_DESIGN_LABEL_CHARS)
                        .ok_or_else(|| invalid(format!("arista {n}: etiqueta vacía o excesiva")))?,
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
        .ok_or_else(|| invalid("modelo sin lista de entidades"))?;
    if entities.is_empty() || entities.len() > MAX_ER_ENTITIES {
        return Err(invalid(format!(
            "el modelo debe tener entre 1 y {MAX_ER_ENTITIES} entidades"
        )));
    }
    let relations = json
        .get("relations")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("modelo sin lista de relaciones"))?;
    if relations.len() > MAX_ER_RELATIONS {
        return Err(invalid(format!(
            "demasiadas relaciones: {} (máximo {MAX_ER_RELATIONS})",
            relations.len()
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out_entities = Vec::with_capacity(entities.len());
    for (i, entity) in entities.iter().enumerate() {
        let n = i + 1;
        let name = string_field(entity, "name")
            .filter(|name| valid_id(name))
            .ok_or_else(|| invalid(format!("entidad {n}: nombre inválido")))?;
        if !seen.insert(name.clone()) {
            return Err(invalid(format!("entidad {n}: nombre duplicado")));
        }
        let attributes = entity
            .get("attributes")
            .and_then(|v| v.as_array())
            .ok_or_else(|| invalid(format!("entidad {n}: sin lista de atributos")))?;
        if attributes.is_empty() || attributes.len() > MAX_ER_ATTRIBUTES {
            return Err(invalid(format!(
                "entidad {n}: entre 1 y {MAX_ER_ATTRIBUTES} atributos"
            )));
        }
        let mut seen_attrs = std::collections::HashSet::new();
        let mut out_attrs = Vec::with_capacity(attributes.len());
        for (j, attr) in attributes.iter().enumerate() {
            let m = j + 1;
            let attr_name = string_field(attr, "name")
                .filter(|name| valid_id(name))
                .ok_or_else(|| invalid(format!("entidad {n}: atributo {m} inválido")))?;
            if !seen_attrs.insert(attr_name.clone()) {
                return Err(invalid(format!("entidad {n}: atributo duplicado")));
            }
            let key = attr.get("key").and_then(|v| v.as_bool()).unwrap_or(false);
            out_attrs.push(ErAttribute {
                name: attr_name,
                key,
            });
        }
        let requirements = ref_items(entity, "requirements", n, allowed, "entidad")?;
        out_entities.push(ErEntity {
            name,
            attributes: out_attrs,
            requirements,
        });
    }
    let mut out_relations = Vec::with_capacity(relations.len());
    for (i, relation) in relations.iter().enumerate() {
        let n = i + 1;
        let from = string_field(relation, "from")
            .ok_or_else(|| invalid(format!("relación {n}: sin origen")))?;
        let to = string_field(relation, "to")
            .ok_or_else(|| invalid(format!("relación {n}: sin destino")))?;
        if !seen.contains(&from) {
            return Err(invalid(format!("relación {n}: origen inexistente")));
        }
        if !seen.contains(&to) {
            return Err(invalid(format!("relación {n}: destino inexistente")));
        }
        let label =
            match relation.get("label") {
                None | Some(serde_json::Value::Null) => None,
                Some(value) => {
                    let text = value
                        .as_str()
                        .ok_or_else(|| invalid(format!("relación {n}: etiqueta no textual")))?;
                    Some(non_empty(text, MAX_DESIGN_LABEL_CHARS).ok_or_else(|| {
                        invalid(format!("relación {n}: etiqueta vacía o excesiva"))
                    })?)
                }
            };
        let from_card: Cardinality = relation
            .get("from_card")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| invalid(format!("relación {n}: cardinalidad de origen no admitida")))?;
        let to_card: Cardinality = relation
            .get("to_card")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| invalid(format!("relación {n}: cardinalidad de destino no admitida")))?;
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

/// Referencias a requisitos: dentro del conjunto enviado, sin duplicados,
/// con tope. Vacías permitidas (no todo elemento cita requisitos).
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
        .ok_or_else(|| invalid(format!("{what} {n}: falta {name} o no es lista")))?;
    if values.len() > MAX_DESIGN_REFS {
        return Err(invalid(format!(
            "{what} {n}: demasiadas referencias (máximo {MAX_DESIGN_REFS})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("{what} {n}: referencia no textual")))?;
        let text = text.trim().to_string();
        if text.is_empty() || !allowed.contains(&text) {
            return Err(invalid(format!(
                "{what} {n}: referencia fuera del conjunto enviado"
            )));
        }
        if !seen.insert(text.clone()) {
            return Err(invalid(format!("{what} {n}: referencia duplicada")));
        }
        out.push(text);
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
        .ok_or_else(|| invalid(format!("falta {name} o no es lista")))?;
    if values.len() < min || values.len() > max {
        return Err(invalid(format!(
            "{name} debe tener entre {min} y {max} elementos"
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for (i, value) in values.iter().enumerate() {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("{name}[{}] no es texto", i + 1)))?;
        let text = non_empty(text, MAX_DESIGN_QUESTION_CHARS)
            .ok_or_else(|| invalid(format!("{name}[{}] vacío o excesivo", i + 1)))?;
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

/// Ejecuta una generación de diseño: un único POST sin reintentos, con
/// timeout propio y tope de cuerpo. Misma clasificación de errores que el
/// resto de llamadas. `allowed` son los artefactos enviados como contexto.
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
    let parsed = parse_success_capped(status, &body, secret, DESIGN_MAX_BODY_BYTES)?;
    let validated =
        parse_design_output(&parsed.text, kind, allowed).map_err(|err| err.with_status(status))?;
    Ok(DesignResult {
        design: validated,
        model: parsed.model,
        usage: parsed.usage,
    })
}

/// Versión de la plantilla de actualización (hito 8): el mismo esquema de
/// salida del hito 6, con instrucciones de ajuste en vez de creación.
pub const DESIGN_UPDATE_TEMPLATE_VERSION: u32 = 1;

const FLOW_UPDATE_INSTRUCTION: &str = "Eres un diseñador que PROPONE AJUSTES a un flujo de operación existente porque cambiaron sus requisitos fuente. \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Conserva todo lo que no necesite cambiar y mantén los identificadores de los elementos existentes cuando sea posible; ajusta solo lo justificado por los requisitos actuales. \
Propón el flujo COMPLETO actualizado: title, nodes (id único de letras, dígitos y subrayado, kind entre start, step, decision y end, label y requirements con identificadores de los requisitos enviados), \
edges (origen y destino existentes, label opcional), explanation breve de QUÉ cambió y POR QUÉ, y questions (como mucho 5, vacía si no hay). \
Señala incertidumbres en questions y no presentes supuestos como decisiones aprobadas.";

const ER_UPDATE_INSTRUCTION: &str = "Eres un diseñador que PROPONE AJUSTES a un modelo entidad-relación existente porque cambiaron sus requisitos fuente. \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Conserva todo lo que no necesite cambiar y mantén los nombres de entidades, atributos y relaciones existentes cuando sea posible; ajusta solo lo justificado por los requisitos actuales. \
Propón el modelo COMPLETO actualizado: title, entities (name único de letras, dígitos y subrayado, attributes con name y key, requirements con identificadores de los requisitos enviados), \
relations (extremos existentes, label opcional, from_card y to_card entre 1, 0..1, N y 0..N), explanation breve de QUÉ cambió y POR QUÉ, y questions (como mucho 5, vacía si no hay). \
No propongas tipos de atributos: están fuera del subconjunto. \
Señala incertidumbres en questions y no presentes supuestos como decisiones aprobadas.";

/// Fuente del diseño con su versión utilizada y su versión actual.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateSource {
    pub artifact_id: String,
    pub used_version_id: String,
    pub used_content: String,
    pub current_version_id: String,
    pub current_content: String,
}

/// Cambio del requisito que originó el informe de impacto, si se conoce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginChange {
    pub artifact_id: String,
    pub from_version_id: String,
    pub from_content: String,
    pub current_version_id: String,
    pub current_content: String,
}

/// Monta la entrada para proponer la actualización de un diseño: el diseño
/// actual (JSON canónico), cada fuente con su versión utilizada y actual,
/// el cambio origen y los caminos relevantes. Mismos topes que la creación.
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
                    "[{} @ {} (sin cambios)]\n{}",
                    item.artifact_id,
                    item.current_version_id,
                    truncate_chars(
                        item.current_content.trim(),
                        MAX_DESIGN_CONTEXT_CONTENT_CHARS
                    )
                )
            } else {
                format!(
                    "[{}]\nutilizada {}:\n{}\nactual {}:\n{}",
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
            "\n\nCambio que originó el impacto [{} {} → {}]:\nantes:\n{}\nahora:\n{}",
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
            format!("\n\nCaminos de dependencia:\n{}", path_lines.join("\n"))
        };
        let input = format!(
            "{instruction}\n\nDiseño actual (JSON a actualizar):\n{spec}\n\nFuentes utilizadas frente a actuales ({}):\n{}{origin_text}{paths_text}",
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

/// Elemento del diff estructural: `kind` es `title`, `node`, `edge`,
/// `entity`, `attribute` o `relation`; `detail` describe el cambio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffItem {
    pub kind: String,
    pub id: String,
    pub detail: String,
}

/// Diferencias estructurales deterministas entre dos diseños validados del
/// mismo tipo. Si cambian los identificadores se reflejan como
/// adición+eliminación: nunca se inventan equivalencias.
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

/// Diff entre el diseño actual y el propuesto. Exige el mismo tipo en
/// ambos; el tipo distinto es un error de programación del llamante.
#[derive(Default)]
struct DiffAcc {
    added: Vec<DiffItem>,
    removed: Vec<DiffItem>,
    modified: Vec<DiffItem>,
}

pub fn diff_designs(old: &ValidatedDesign, new: &ValidatedDesign) -> Result<DesignDiff, MetaError> {
    if old.kind != new.kind {
        return Err(invalid("no se comparan diseños de distinto tipo"));
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
        _ => return Err(invalid("no se comparan diseños de distinto tipo")),
    }
    match (&old.er, &new.er) {
        (Some(before), Some(after)) => diff_er(before, after, &mut acc),
        (None, None) => {}
        _ => return Err(invalid("no se comparan diseños de distinto tipo")),
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

    const SECRET: &str = "sk-prueba";

    fn allowed() -> Vec<String> {
        vec!["req-3".to_string(), "req-5".to_string()]
    }

    fn envelope_text(fixture: &str) -> String {
        crate::protocol::parse_success_capped(200, fixture, SECRET, DESIGN_MAX_BODY_BYTES)
            .expect("envolvente válida")
            .text
    }

    #[test]
    fn parses_valid_flow_fixture_and_renders_mermaid() {
        let body = include_str!("../tests/fixtures/design_flow_completed.json");
        let design = parse_design_output(&envelope_text(body), DesignKind::Flow, &allowed())
            .expect("válido");
        assert_eq!(design.title, "Confirmar venta con stock");
        let flow = design.flow.as_ref().expect("flujo");
        assert_eq!(flow.nodes.len(), 4);
        assert_eq!(flow.edges.len(), 4);
        assert_eq!(design.questions.len(), 1);
        // El ciclo decisión→revisar es válido en un flujo de operación.
        assert!(flow
            .edges
            .iter()
            .any(|e| e.from == "decision" && e.to == "revisar"));
        let mermaid = to_mermaid(&design);
        let expected = "flowchart TD\n\
             \x20   inicio([\"Venta creada\"])\n\
             \x20   revisar[\"Revisar stock disponible\"]\n\
             \x20   decision{\"¿Hay stock suficiente?\"}\n\
             \x20   fin([\"Venta confirmada\"])\n\
             \x20   inicio --> revisar\n\
             \x20   revisar --> decision\n\
             \x20   decision -- \"sí\" --> fin\n\
             \x20   decision -- \"no\" --> revisar\n";
        assert_eq!(mermaid, expected);
        // Determinista: segunda serialización idéntica.
        assert_eq!(to_mermaid(&design), expected);
    }

    #[test]
    fn parses_valid_er_fixture_and_renders_mermaid() {
        let body = include_str!("../tests/fixtures/design_er_completed.json");
        let design = parse_design_output(&envelope_text(body), DesignKind::DataModel, &allowed())
            .expect("válido");
        assert_eq!(design.title, "Ventas y stock");
        let er = design.er.as_ref().expect("modelo");
        assert_eq!(er.entities.len(), 2);
        assert_eq!(er.relations.len(), 1);
        let mermaid = to_mermaid(&design);
        let expected = "erDiagram\n\
             \x20   VENTA {\n\
             \x20       string id PK\n\
             \x20       string estado\n\
             \x20   }\n\
             \x20   LINEA {\n\
             \x20       string id PK\n\
             \x20       string cantidad\n\
             \x20   }\n\
             \x20   VENTA ||--}| LINEA : \"contiene\"\n";
        assert_eq!(mermaid, expected);
    }

    #[test]
    fn er_relations_always_carry_a_quoted_label() {
        // Regresión: erDiagram exige `: etiqueta` y Mermaid 12 falla con
        // `Expecting COLON` si falta; multi-palabra exige comillas.
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
        let design = parse_design_output(&text, DesignKind::DataModel, &[]).expect("válido");
        let mermaid = to_mermaid(&design);
        let relations: Vec<&str> = mermaid.lines().filter(|line| line.contains("--")).collect();
        assert_eq!(relations.len(), 3);
        for line in &relations {
            assert!(
                line.contains(" : \"") && line.ends_with('"'),
                "relación sin etiqueta entrecomillada: {line}"
            );
        }
        assert!(mermaid.contains("A ||--}| B : \"rel\""));
        assert!(mermaid.contains("B ||--}o C : \"se compone de varias\""));
        // Hostil neutralizada pero etiqueta presente.
        assert!(!mermaid.contains('%') && !mermaid.contains('<'));
    }

    #[test]
    fn canonical_json_roundtrips() {
        let body = include_str!("../tests/fixtures/design_flow_completed.json");
        let design = parse_design_output(&envelope_text(body), DesignKind::Flow, &allowed())
            .expect("válido");
        let canonical = canonical_json(&design);
        let again =
            parse_design_output(&canonical, DesignKind::Flow, &allowed()).expect("canónico");
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
        // Las etiquetas se aceptan como texto libre con tope: es el
        // serializador quien las neutraliza al derivar Mermaid.
        let design = parse_design_output(&text, DesignKind::Flow, &[]).expect("pasa validación");
        let mermaid = to_mermaid(&design);
        // Ni etiquetas HTML, ni directivas, ni URLs, ni sintaxis de enlace:
        // (`>` solo sobrevive en las flechas estructurales `-->`.)
        assert!(!mermaid.contains('<'), "{mermaid}");
        assert!(!mermaid.contains("%%"), "{mermaid}");
        assert!(!mermaid.contains("http://"), "{mermaid}");
        assert!(!mermaid.contains("]("), "{mermaid}");
    }

    #[test]
    fn rejects_duplicate_ids_dangling_edges_and_bad_cards() {
        // Nodos duplicados.
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
        // Arista a nodo inexistente.
        let dangling = serde_json::json!({
            "title": "T",
            "nodes": [{"id": "n", "kind": "step", "label": "A", "requirements": []}],
            "edges": [{"from": "n", "to": "fantasma"}],
            "explanation": "E", "questions": []
        })
        .to_string();
        let err = parse_design_output(&dangling, DesignKind::Flow, &[]).expect_err("colgada");
        assert_eq!(err.kind, MetaErrorKind::InvalidResponse);
        // Cardinalidad no admitida.
        let card = serde_json::json!({
            "title": "T",
            "entities": [
                {"name": "A", "attributes": [{"name": "id", "key": true}], "requirements": []},
                {"name": "B", "attributes": [{"name": "id", "key": true}], "requirements": []}
            ],
            "relations": [{"from": "A", "to": "B", "from_card": "1", "to_card": "muchos"}],
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
            .expect_err("ajeno");
        assert!(err.message.contains("fuera del conjunto"));
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
        // ER pedido pero flujo recibido.
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
            let body = build_design_body(kind, "muse-spark-1.3", "entrada");
            assert_eq!(body["max_output_tokens"], DESIGN_MAX_OUTPUT_TOKENS);
            let format = &body["text"]["format"];
            assert_eq!(format["type"], "json_schema");
            assert_eq!(format["name"], name);
            assert!(format["schema"]["properties"][key].is_object());
        }
    }

    #[test]
    fn design_input_renders_approved_context_with_caps() {
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
        parse_design_output(text, DesignKind::Flow, &allowed()).expect("flujo válido")
    }

    fn er_spec(text: &str) -> ValidatedDesign {
        parse_design_output(text, DesignKind::DataModel, &allowed()).expect("ER válido")
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
        assert!(input.contains("PROPONE AJUSTES"));
        assert!(input.contains("{\"title\":\"Flujo\"}"));
        assert!(input.contains("utilizada req-3-v1"));
        assert!(input.contains("actual req-3-v2"));
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
                used_content: "Mismo.".to_string(),
                current_version_id: format!("req-{i:02}-v1"),
                current_content: "Mismo.".to_string(),
            })
            .collect();
        let big_spec = format!("{{\"title\":\"{}\"}}", "x".repeat(MAX_DESIGN_INPUT_CHARS));
        let input = build_update_input(DesignKind::DataModel, &big_spec, &sources, None, &[]);
        assert!(input.contains("(sin cambios)"));
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
                "explanation": "Antes.",
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
                "explanation": "Después.",
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
        let fin = diff.modified.iter().find(|i| i.id == "fin").expect("fin");
        assert!(fin.detail.contains("Venta confirmada"));
        assert!(fin.detail.contains("Venta cerrada"));
        // Determinista: mismo orden en cada cálculo.
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
                "explanation": "Antes.",
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
                "explanation": "Después.",
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
