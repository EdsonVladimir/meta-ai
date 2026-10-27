//! Generación asistida de diseño vinculado a requisitos (hito 6).
//!
//! Misma modalidad que `generation`: Responses API con `text.format`
//! (`type: "json_schema"`) y validación autoritativa en Rust. Cada llamada
//! genera UNA propuesta de flujo de operación o de modelo entidad-relación
//! a partir de requisitos aprobados seleccionados.
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

/// Versión de la plantilla de instrucciones de diseño.
pub const DESIGN_TEMPLATE_VERSION: u32 = 1;
/// Límites de entrada (el contexto lo filtra `ruth-api` a aprobados).
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

const FLOW_INSTRUCTION: &str = "Eres un diseñador que propone un flujo de operación a partir de requisitos aprobados. \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Propón UN flujo: title, nodes (al menos uno; cada uno con id único de letras, dígitos y subrayado, kind entre start, step, decision y end, label y requirements con identificadores de los requisitos enviados), \
edges (origen y destino existentes, label opcional), explanation breve y questions (como mucho 5, vacía si no hay). \
Señala ambigüedades en questions y no inventes decisiones como aprobadas.";

const ER_INSTRUCTION: &str = "Eres un diseñador que propone un modelo entidad-relación a partir de requisitos aprobados. \
Responde SOLO con el objeto JSON pedido, sin texto adicional. \
Propón UN modelo: title, entities (al menos una; cada una con name único de letras, dígitos y subrayado, attributes con al menos un atributo de name y key, y requirements con identificadores de los requisitos enviados), \
relations (extremos existentes, label opcional, from_card y to_card entre 1, 0..1, N y 0..N), explanation breve y questions (como mucho 5, vacía si no hay). \
No propongas tipos de atributos: están fuera del subconjunto. \
Señala ambigüedades en questions y no inventes decisiones como aprobadas.";

/// Monta el texto enviado al modelo. El contexto ya llega filtrado a
/// requisitos aprobados seleccionados; aquí solo se aplican topes.
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
            "{instruction}\n\nRequisitos aprobados seleccionados (contexto; {}):\n{}",
            rendered.len(),
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

fn invalid(message: impl Into<String>) -> MetaError {
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
        match &relation.label {
            Some(label) => out.push_str(&format!(" : {}\n", escape_label(label))),
            None => out.push('\n'),
        }
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

fn string_field(value: &serde_json::Value, name: &str) -> Option<String> {
    value.get(name)?.as_str().map(str::to_string)
}

fn non_empty(text: &str, max_chars: usize) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max_chars {
        return None;
    }
    Some(trimmed.to_string())
}

fn valid_id(id: &str) -> bool {
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
             \x20   VENTA ||--}| LINEA : contiene\n";
        assert_eq!(mermaid, expected);
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
}
