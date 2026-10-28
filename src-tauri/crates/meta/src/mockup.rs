//! Contrato estructurado de mockups (diseño vivo, etapa B).
//!
//! Los mockups son artefactos versionados dibujados por la persona: este
//! módulo define su subconjunto inicial y su validación autoritativa en
//! Rust. El JSON canónico es el contenido de la versión; la disposición
//! visual (posiciones) vive aparte, en `design_layouts`, y mover un
//! componente jamás crea una versión semántica.
//!
//! ## Subconjunto inicial (documentado, no es un constructor de UI universal)
//!
//! Mockup: título y pantallas con identidad estable (`[A-Za-z0-9_]`,
//! única en el mockup). Cada pantalla: título, componentes y referencias.
//!
//! Componentes (`kind`):
//! - `text`: texto mostrado (`text`).
//! - `field`: campo con `label`, `field_type` (`text`, `number`, `date`,
//!   `boolean`), `required`, `validation` opcional y `origin` obligatorio.
//! - `selector`: `label`, `options` (0–24), `required` y `origin`.
//! - `button`: `label`, `action` opcional (operación) y `target` opcional
//!   (pantalla existente a la que navega).
//! - `table`: `label`, `columns` (1–12) y `origin`.
//!
//! `origin` declara de dónde sale el dato y es obligatorio: `persisted`,
//! `calculated`, `temporary`, `external` o `undefined`. Un campo visual NO
//! implica una columna de base de datos: nada crea tablas ni columnas por
//! suposición silenciosa.
//!
//! Referencias explícitas (enlaces semánticos, informativos):
//! - `requirements`: identificadores de requisito del conjunto declarado.
//! - `designs`: pares `artefacto/elemento` (`flujo-1/inicio`) cuyo artefacto
//!   pertenece al conjunto declarado y cuyo elemento usa el alfabeto de
//!   identificadores. Señalan intención, no son dependencias de generación
//!   del núcleo: no participan en ciclos prohibidos ni en el cálculo de
//!   vigencia. La dependencia real (versión exacta utilizada) se registra
//!   aparte, a nivel de versión, como en el resto de diseños.
//!
//! Toda referencia debe pertenecer al conjunto declarado (`allowed`): lo
//! demás se rechaza. Los identificadores de componente son únicos en todo
//! el mockup: el mapa de disposiciones es plano por versión (clave = id del
//! componente). El lienzo edita una pantalla cada vez.

use serde::{Deserialize, Serialize};

use crate::design::{invalid, non_empty, string_field, valid_id};
use crate::error::MetaError;

/// Límites del subconjunto inicial.
pub const MAX_MOCKUP_SCREENS: usize = 12;
pub const MAX_MOCKUP_COMPONENTS: usize = 40;
pub const MAX_MOCKUP_OPTIONS: usize = 24;
pub const MAX_MOCKUP_COLUMNS: usize = 12;
pub const MAX_MOCKUP_TITLE_CHARS: usize = 200;
pub const MAX_MOCKUP_LABEL_CHARS: usize = 160;
pub const MAX_MOCKUP_TEXT_CHARS: usize = 1000;
pub const MAX_MOCKUP_VALIDATION_CHARS: usize = 500;
pub const MAX_MOCKUP_REFS: usize = 8;

/// Tipo de componente del subconjunto inicial.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupComponentKind {
    Text,
    Field,
    Selector,
    Button,
    Table,
}

/// Tipo de dato de un campo visual. Es presentación, no esquema de base.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupFieldType {
    Text,
    Number,
    Date,
    Boolean,
}

/// Origen declarado de un dato visual. Obligatorio: el silencio no puede
/// significar «persistido».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupOrigin {
    Persisted,
    Calculated,
    Temporary,
    External,
    Undefined,
}

impl MockupOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Persisted => "persisted",
            Self::Calculated => "calculated",
            Self::Temporary => "temporary",
            Self::External => "external",
            Self::Undefined => "undefined",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MockupComponent {
    pub id: String,
    pub kind: MockupComponentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_type: Option<MockupFieldType>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validation: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<MockupOrigin>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requirements: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub designs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MockupScreen {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requirements: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub designs: Vec<String>,
    pub components: Vec<MockupComponent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedMockup {
    pub title: String,
    pub screens: Vec<MockupScreen>,
}

/// Valida un valor como mockup. `allowed` son los identificadores de
/// artefacto declarados como fuentes: toda referencia debe pertenecer al
/// conjunto. Rechaza sin crear nada ante campos inválidos, ids duplicados,
/// destinos inexistentes, orígenes ausentes o referencias fuera del conjunto.
pub fn validate_mockup_value(
    value: &serde_json::Value,
    allowed: &[String],
) -> Result<ValidatedMockup, MetaError> {
    if let Some(kind) = value.get("kind").and_then(|v| v.as_str()) {
        if kind != "mockup" {
            return Err(invalid(format!("tipo inesperado: {kind}")));
        }
    }
    let title = string_field(value, "title")
        .and_then(|t| non_empty(&t, MAX_MOCKUP_TITLE_CHARS))
        .ok_or_else(|| invalid("mockup sin título"))?;
    let screens = value
        .get("screens")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("mockup sin lista de pantallas"))?;
    if screens.len() > MAX_MOCKUP_SCREENS {
        return Err(invalid(format!(
            "demasiadas pantallas: {} (máximo {MAX_MOCKUP_SCREENS})",
            screens.len()
        )));
    }
    // Cero pantallas es un lienzo en blanco válido: el editor crea el
    // artefacto y la persona dibuja después.
    let mut seen_screens = std::collections::HashSet::new();
    let mut seen_components = std::collections::HashSet::new();
    let mut out_screens = Vec::with_capacity(screens.len());
    for (i, screen) in screens.iter().enumerate() {
        let n = i + 1;
        let id = string_field(screen, "id")
            .filter(|id| valid_id(id))
            .ok_or_else(|| invalid(format!("pantalla {n}: identificador inválido")))?;
        if !seen_screens.insert(id.clone()) {
            return Err(invalid(format!("pantalla {n}: identificador duplicado")));
        }
        let screen_title = string_field(screen, "title")
            .and_then(|t| non_empty(&t, MAX_MOCKUP_TITLE_CHARS))
            .ok_or_else(|| invalid(format!("pantalla {n}: título vacío o excesivo")))?;
        let requirements = ref_list(screen, "requirements", n, allowed, "pantalla")?;
        let designs = design_refs(screen, n, allowed, "pantalla")?;
        let components = screen
            .get("components")
            .and_then(|v| v.as_array())
            .ok_or_else(|| invalid(format!("pantalla {n}: sin lista de componentes")))?;
        if components.len() > MAX_MOCKUP_COMPONENTS {
            return Err(invalid(format!(
                "pantalla {n}: demasiados componentes (máximo {MAX_MOCKUP_COMPONENTS})"
            )));
        }
        let mut out_components = Vec::with_capacity(components.len());
        for (j, component) in components.iter().enumerate() {
            let m = j + 1;
            let cid = string_field(component, "id")
                .filter(|id| valid_id(id))
                .ok_or_else(|| {
                    invalid(format!(
                        "pantalla {n} componente {m}: identificador inválido"
                    ))
                })?;
            if !seen_components.insert(cid.clone()) {
                return Err(invalid(format!(
                    "pantalla {n} componente {m}: identificador duplicado en el mockup"
                )));
            }
            out_components.push(parse_component(component, n, m, allowed)?);
        }
        out_screens.push(MockupScreen {
            id,
            title: screen_title,
            requirements,
            designs,
            components: out_components,
        });
    }
    // Los destinos de navegación deben existir (tras conocer las pantallas).
    for screen in &out_screens {
        for component in &screen.components {
            if let Some(target) = &component.target {
                if !seen_screens.contains(target) {
                    return Err(invalid(format!(
                        "pantalla {} componente {}: destino inexistente ({target})",
                        screen.id, component.id
                    )));
                }
            }
        }
    }
    Ok(ValidatedMockup {
        title,
        screens: out_screens,
    })
}

fn parse_component(
    component: &serde_json::Value,
    n: usize,
    m: usize,
    allowed: &[String],
) -> Result<MockupComponent, MetaError> {
    let id = string_field(component, "id")
        .filter(|id| valid_id(id))
        .ok_or_else(|| {
            invalid(format!(
                "pantalla {n} componente {m}: identificador inválido"
            ))
        })?;
    let kind: MockupComponentKind = component
        .get("kind")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| invalid(format!("pantalla {n} componente {m}: tipo inválido")))?;
    let tag = format!("pantalla {n} componente {m}");
    let label = match component.get("label") {
        None | Some(serde_json::Value::Null) => None,
        Some(_) => Some(
            string_field(component, "label")
                .and_then(|t| non_empty(&t, MAX_MOCKUP_LABEL_CHARS))
                .ok_or_else(|| invalid(format!("{tag}: etiqueta vacía o excesiva")))?,
        ),
    };
    let requirements = ref_list(component, "requirements", m, allowed, &tag)?;
    let designs = design_refs(component, m, allowed, &tag)?;
    let mut out = MockupComponent {
        id,
        kind,
        text: None,
        label,
        field_type: None,
        required: component
            .get("required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        validation: None,
        options: Vec::new(),
        columns: Vec::new(),
        action: None,
        target: None,
        origin: None,
        requirements,
        designs,
    };
    match kind {
        MockupComponentKind::Text => {
            out.text = Some(
                string_field(component, "text")
                    .and_then(|t| non_empty(&t, MAX_MOCKUP_TEXT_CHARS))
                    .ok_or_else(|| invalid(format!("{tag}: texto vacío o excesivo")))?,
            );
        }
        MockupComponentKind::Field => {
            require_label(&out, &tag)?;
            out.field_type = Some(
                component
                    .get("field_type")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .ok_or_else(|| invalid(format!("{tag}: tipo de campo inválido")))?,
            );
            out.validation = match component.get("validation") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => Some(
                    string_field(component, "validation")
                        .and_then(|t| non_empty(&t, MAX_MOCKUP_VALIDATION_CHARS))
                        .ok_or_else(|| invalid(format!("{tag}: validación vacía o excesiva")))?,
                ),
            };
            out.origin = Some(require_origin(component, &tag)?);
        }
        MockupComponentKind::Selector => {
            require_label(&out, &tag)?;
            out.options = string_list(
                component,
                "options",
                &tag,
                MAX_MOCKUP_OPTIONS,
                MAX_MOCKUP_LABEL_CHARS,
            )?;
            out.origin = Some(require_origin(component, &tag)?);
        }
        MockupComponentKind::Button => {
            require_label(&out, &tag)?;
            out.action = match component.get("action") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => Some(
                    string_field(component, "action")
                        .and_then(|t| non_empty(&t, MAX_MOCKUP_LABEL_CHARS))
                        .ok_or_else(|| invalid(format!("{tag}: acción vacía o excesiva")))?,
                ),
            };
            out.target = match component.get("target") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => Some(
                    string_field(component, "target")
                        .filter(|id| valid_id(id))
                        .ok_or_else(|| invalid(format!("{tag}: destino inválido")))?,
                ),
            };
        }
        MockupComponentKind::Table => {
            require_label(&out, &tag)?;
            out.columns = string_list(
                component,
                "columns",
                &tag,
                MAX_MOCKUP_COLUMNS,
                MAX_MOCKUP_LABEL_CHARS,
            )?;
            if out.columns.is_empty() {
                return Err(invalid(format!(
                    "{tag}: la tabla necesita al menos una columna"
                )));
            }
            out.origin = Some(require_origin(component, &tag)?);
        }
    }
    Ok(out)
}

fn require_label(out: &MockupComponent, tag: &str) -> Result<(), MetaError> {
    if out.label.is_none() {
        return Err(invalid(format!("{tag}: falta la etiqueta")));
    }
    Ok(())
}

fn require_origin(component: &serde_json::Value, tag: &str) -> Result<MockupOrigin, MetaError> {
    component
        .get("origin")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| {
            invalid(format!(
                "{tag}: falta el origen del dato (persisted, calculated, temporary, external o undefined)"
            ))
        })
}

fn string_list(
    parent: &serde_json::Value,
    name: &str,
    tag: &str,
    max_items: usize,
    max_chars: usize,
) -> Result<Vec<String>, MetaError> {
    let Some(node) = parent.get(name) else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    }
    let values = node
        .as_array()
        .ok_or_else(|| invalid(format!("{tag}: {name} no es lista")))?;
    if values.len() > max_items {
        return Err(invalid(format!(
            "{tag}: demasiados elementos en {name} (máximo {max_items})"
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("{tag}: {name} no textual")))?;
        out.push(
            non_empty(text, max_chars)
                .ok_or_else(|| invalid(format!("{tag}: {name} vacío o excesivo")))?,
        );
    }
    Ok(out)
}

/// Referencias a requisitos: dentro del conjunto declarado, sin duplicados,
/// con tope. Ausentes equivalen a vacías (el canónico omite las vacías).
fn ref_list(
    parent: &serde_json::Value,
    name: &str,
    n: usize,
    allowed: &[String],
    what: &str,
) -> Result<Vec<String>, MetaError> {
    let Some(node) = parent.get(name) else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    }
    let values = node
        .as_array()
        .ok_or_else(|| invalid(format!("{what} {n}: {name} no es lista")))?;
    if values.len() > MAX_MOCKUP_REFS {
        return Err(invalid(format!(
            "{what} {n}: demasiadas referencias (máximo {MAX_MOCKUP_REFS})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let id = value
            .as_str()
            .ok_or_else(|| invalid(format!("{what} {n}: referencia no textual")))?;
        if !allowed.contains(&id.to_string()) {
            return Err(invalid(format!(
                "{what} {n}: referencia fuera del conjunto ({id})"
            )));
        }
        if !seen.insert(id.to_string()) {
            return Err(invalid(format!("{what} {n}: referencia duplicada ({id})")));
        }
        out.push(id.to_string());
    }
    Ok(out)
}

/// Referencias a elementos de diseño (`artefacto/elemento`): el artefacto
/// debe pertenecer al conjunto declarado; el elemento usa el alfabeto de
/// identificadores. Son enlaces semánticos informativos, no dependencias
/// del núcleo: no crean ciclos ni vigencia.
fn design_refs(
    parent: &serde_json::Value,
    n: usize,
    allowed: &[String],
    what: &str,
) -> Result<Vec<String>, MetaError> {
    let Some(node) = parent.get("designs") else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    }
    let values = node
        .as_array()
        .ok_or_else(|| invalid(format!("{what} {n}: designs no es lista")))?;
    if values.len() > MAX_MOCKUP_REFS {
        return Err(invalid(format!(
            "{what} {n}: demasiadas referencias (máximo {MAX_MOCKUP_REFS})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let raw = value
            .as_str()
            .ok_or_else(|| invalid(format!("{what} {n}: referencia no textual")))?;
        let (artifact, element) = raw.split_once('/').ok_or_else(|| {
            invalid(format!(
                "{what} {n}: referencia sin forma artefacto/elemento ({raw})"
            ))
        })?;
        if artifact.is_empty() || !valid_id(element) {
            return Err(invalid(format!("{what} {n}: referencia inválida ({raw})")));
        }
        if !allowed.contains(&artifact.to_string()) {
            return Err(invalid(format!(
                "{what} {n}: referencia fuera del conjunto ({raw})"
            )));
        }
        if !seen.insert(raw.to_string()) {
            return Err(invalid(format!("{what} {n}: referencia duplicada ({raw})")));
        }
        out.push(raw.to_string());
    }
    Ok(out)
}

/// Contenido autoritativo canónico: serialización fija de lo validado.
pub fn canonical_mockup_json(mockup: &ValidatedMockup) -> String {
    let mut map = serde_json::Map::new();
    map.insert("title".to_string(), serde_json::json!(mockup.title));
    map.insert("kind".to_string(), serde_json::json!("mockup"));
    map.insert("screens".to_string(), serde_json::json!(mockup.screens));
    serde_json::to_string(&map).expect("el mockup validado siempre serializa")
}

/// Resumen legible de un mockup guardado para usarlo como contexto de una
/// generación de diseño: pantallas con sus componentes (tipo, etiqueta y
/// origen), sin posiciones. Si el contenido no parsea (corrupto a mano),
/// devuelve un marcador honesto en vez de inventar.
pub fn render_mockup_excerpt(spec_json: &str, max_chars: usize) -> String {
    let fallback = "(mockup con contenido no estructurado)".to_string();
    let Ok(value) = serde_json::from_str::<serde_json::Value>(spec_json) else {
        return fallback;
    };
    let (title, screens) = match validate_mockup_value(&value, &refs_of(&value)) {
        Ok(validated) => (validated.title, validated.screens),
        Err(_) => return fallback,
    };
    let mut out = format!("Mockup: {title}\n");
    for screen in &screens {
        out.push_str(&format!("Pantalla {} ({})\n", screen.id, screen.title));
        for component in &screen.components {
            out.push_str(&format!("- {}\n", describe_component(component)));
        }
    }
    let trimmed = out.trim_end().to_string();
    if trimmed.chars().count() <= max_chars {
        return trimmed;
    }
    let end = trimmed
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(trimmed.len());
    format!("{}…", trimmed[..end].trim_end())
}

/// Referencias citadas en el contenido: permite revalidar lo guardado sin
/// conocer el conjunto declarado original (igual que en diseños).
fn refs_of(value: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    let empty = Vec::new();
    let screens = value
        .get("screens")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    for screen in screens {
        collect_refs(screen, &mut out);
        let components = screen.get("components").and_then(|v| v.as_array());
        if let Some(components) = components {
            for component in components {
                collect_refs(component, &mut out);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn collect_refs(node: &serde_json::Value, out: &mut Vec<String>) {
    if let Some(list) = node.get("requirements").and_then(|v| v.as_array()) {
        for item in list.iter().filter_map(|v| v.as_str()) {
            out.push(item.to_string());
        }
    }
    if let Some(list) = node.get("designs").and_then(|v| v.as_array()) {
        for item in list.iter().filter_map(|v| v.as_str()) {
            if let Some((artifact, _)) = item.split_once('/') {
                out.push(artifact.to_string());
            }
        }
    }
}

fn describe_component(component: &MockupComponent) -> String {
    let label = component.label.as_deref().unwrap_or("");
    match component.kind {
        MockupComponentKind::Text => {
            format!(
                "texto {}: {}",
                component.id,
                component.text.as_deref().unwrap_or("")
            )
        }
        MockupComponentKind::Field => format!(
            "campo {} «{}» ({}, {}{})",
            component.id,
            label,
            component.field_type.map(field_type_str).unwrap_or("?"),
            if component.required {
                "obligatorio"
            } else {
                "opcional"
            },
            component
                .origin
                .map(|o| format!(", origen {}", o.as_str()))
                .unwrap_or_default(),
        ),
        MockupComponentKind::Selector => format!(
            "selector {} «{}» ({} opciones{})",
            component.id,
            label,
            component.options.len(),
            component
                .origin
                .map(|o| format!(", origen {}", o.as_str()))
                .unwrap_or_default(),
        ),
        MockupComponentKind::Button => {
            let mut extra = String::new();
            if let Some(action) = &component.action {
                extra.push_str(&format!("acción {action}"));
            }
            if let Some(target) = &component.target {
                if !extra.is_empty() {
                    extra.push_str(", ");
                }
                extra.push_str(&format!("va a {target}"));
            }
            if extra.is_empty() {
                format!("botón {} «{}»", component.id, label)
            } else {
                format!("botón {} «{}» ({extra})", component.id, label)
            }
        }
        MockupComponentKind::Table => format!(
            "tabla {} «{}» ({} columnas{})",
            component.id,
            label,
            component.columns.len(),
            component
                .origin
                .map(|o| format!(", origen {}", o.as_str()))
                .unwrap_or_default(),
        ),
    }
}

/// Resumen estructurado de un mockup validado para especificación y
/// exportación: pantallas con sus componentes en orden. Determinista.
pub fn summarize_mockup(mockup: &ValidatedMockup) -> String {
    let total: usize = mockup.screens.iter().map(|s| s.components.len()).sum();
    let mut out = format!(
        "Mockup: {} {}, {} {}.\n",
        mockup.screens.len(),
        plural_es(mockup.screens.len(), "pantalla", "pantallas"),
        total,
        plural_es(total, "componente", "componentes"),
    );
    for screen in &mockup.screens {
        out.push_str(&format!(
            "\nPantalla {} ({}): {} {}.\n",
            screen.id,
            screen.title,
            screen.components.len(),
            plural_es(screen.components.len(), "componente", "componentes"),
        ));
        for component in &screen.components {
            out.push_str(&format!("- {}\n", describe_component(component)));
        }
    }
    out.push('\n');
    out
}

fn plural_es<'a>(count: usize, one: &'a str, many: &'a str) -> &'a str {
    if count == 1 {
        one
    } else {
        many
    }
}

fn field_type_str(kind: MockupFieldType) -> &'static str {
    match kind {
        MockupFieldType::Text => "texto",
        MockupFieldType::Number => "número",
        MockupFieldType::Date => "fecha",
        MockupFieldType::Boolean => "booleano",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reserva() -> serde_json::Value {
        serde_json::json!({
            "title": "Nueva reserva",
            "screens": [{
                "id": "nueva_reserva",
                "title": "Nueva reserva",
                "requirements": ["req-1"],
                "designs": [],
                "components": [
                    {"id": "t1", "kind": "text", "text": "Nueva reserva",
                     "requirements": [], "designs": []},
                    {"id": "f_cliente", "kind": "field", "label": "Cliente",
                     "field_type": "text", "required": true, "origin": "persisted",
                     "requirements": ["req-1"], "designs": []},
                    {"id": "f_cantidad", "kind": "field", "label": "Cantidad",
                     "field_type": "number", "required": true, "origin": "temporary",
                     "requirements": [], "designs": []},
                    {"id": "b_ok", "kind": "button", "label": "Confirmar",
                     "action": "confirmar_reserva", "requirements": [], "designs": []}
                ]
            }]
        })
    }

    #[test]
    fn valid_mockup_roundtrips_through_canonical() {
        let validated = validate_mockup_value(&reserva(), &["req-1".to_string()]).expect("válido");
        assert_eq!(validated.title, "Nueva reserva");
        assert_eq!(validated.screens.len(), 1);
        assert_eq!(validated.screens[0].components.len(), 4);
        let canonical = canonical_mockup_json(&validated);
        let reparsed: serde_json::Value = serde_json::from_str(&canonical).expect("json");
        assert_eq!(reparsed["kind"], "mockup");
        let again = validate_mockup_value(&reparsed, &["req-1".to_string()]).expect("revalida");
        assert_eq!(again, validated);
    }

    #[test]
    fn empty_screens_are_a_valid_blank_canvas() {
        let value = serde_json::json!({"title": "Vacío", "screens": []});
        let validated = validate_mockup_value(&value, &[]).expect("lienzo en blanco");
        assert!(validated.screens.is_empty());
    }

    #[test]
    fn duplicate_screen_ids_rejected() {
        let mut value = reserva();
        value["screens"]
            .as_array_mut()
            .expect("lista")
            .push(serde_json::json!({
                "id": "nueva_reserva", "title": "Duplicada",
                "requirements": [], "designs": [], "components": []
            }));
        let err = validate_mockup_value(&value, &["req-1".to_string()]).expect_err("duplicada");
        assert!(err.message.contains("duplicado"), "{}", err.message);
    }

    #[test]
    fn duplicate_component_ids_rejected() {
        let mut value = reserva();
        value["screens"][0]["components"]
            .as_array_mut()
            .expect("lista")
            .push(
                serde_json::json!({"id": "t1", "kind": "text", "text": "Otro",
                               "requirements": [], "designs": []}),
            );
        let err = validate_mockup_value(&value, &["req-1".to_string()]).expect_err("duplicado");
        assert!(err.message.contains("duplicado"), "{}", err.message);
    }

    #[test]
    fn field_without_origin_rejected() {
        let mut value = reserva();
        value["screens"][0]["components"][1]
            .as_object_mut()
            .expect("campo")
            .remove("origin");
        let err = validate_mockup_value(&value, &["req-1".to_string()]).expect_err("sin origen");
        assert!(err.message.contains("origen"), "{}", err.message);
    }

    #[test]
    fn unknown_origin_rejected() {
        let mut value = reserva();
        value["screens"][0]["components"][1]["origin"] = serde_json::json!("magia");
        validate_mockup_value(&value, &["req-1".to_string()]).expect_err("origen inválido");
    }

    #[test]
    fn navigation_to_missing_screen_rejected() {
        let mut value = reserva();
        value["screens"][0]["components"][3]["target"] = serde_json::json!("inexistente");
        let err = validate_mockup_value(&value, &["req-1".to_string()]).expect_err("sin destino");
        assert!(err.message.contains("inexistente"), "{}", err.message);
    }

    #[test]
    fn refs_outside_allowed_set_rejected() {
        let err = validate_mockup_value(&reserva(), &[]).expect_err("fuera del conjunto");
        assert!(err.message.contains("conjunto"), "{}", err.message);
    }

    #[test]
    fn design_refs_need_artifact_and_element() {
        let mut value = reserva();
        value["screens"][0]["requirements"] = serde_json::json!([]);
        value["screens"][0]["components"][0]["designs"] = serde_json::json!(["flujo-1/inicio"]);
        value["screens"][0]["components"][1]["requirements"] = serde_json::json!([]);
        let validated =
            validate_mockup_value(&value, &["flujo-1".to_string()]).expect("ref a diseño");
        assert_eq!(
            validated.screens[0].components[0].designs,
            vec!["flujo-1/inicio".to_string()]
        );
        let mut bad = reserva();
        bad["screens"][0]["components"][0]["designs"] = serde_json::json!(["sin-barra"]);
        bad["screens"][0]["requirements"] = serde_json::json!([]);
        bad["screens"][0]["components"][1]["requirements"] = serde_json::json!([]);
        validate_mockup_value(&bad, &["flujo-1".to_string()]).expect_err("sin forma");
    }

    #[test]
    fn component_ids_are_unique_across_screens() {
        let mut value = reserva();
        value["screens"]
            .as_array_mut()
            .expect("lista")
            .push(serde_json::json!({
                "id": "otra", "title": "Otra",
                "requirements": [], "designs": [],
                "components": [
                    {"id": "t1", "kind": "text", "text": "Repetido",
                     "requirements": [], "designs": []}
                ]
            }));
        let err = validate_mockup_value(&value, &["req-1".to_string()])
            .expect_err("repetido entre pantallas");
        assert!(err.message.contains("duplicado"), "{}", err.message);
    }

    #[test]
    fn table_needs_columns_and_origin() {
        let value = serde_json::json!({
            "title": "Tablas",
            "screens": [{
                "id": "p", "title": "P", "requirements": [], "designs": [],
                "components": [
                    {"id": "tb", "kind": "table", "label": "Líneas",
                     "columns": ["a", "b"], "origin": "persisted",
                     "requirements": [], "designs": []}
                ]
            }]
        });
        let validated = validate_mockup_value(&value, &[]).expect("tabla válida");
        assert_eq!(validated.screens[0].components[0].columns.len(), 2);
        let mut bad = value.clone();
        bad["screens"][0]["components"][0]["columns"] = serde_json::json!([]);
        validate_mockup_value(&bad, &[]).expect_err("sin columnas");
    }

    #[test]
    fn excerpt_describes_screens_without_positions() {
        let validated = validate_mockup_value(&reserva(), &["req-1".to_string()]).expect("válido");
        let excerpt = render_mockup_excerpt(&canonical_mockup_json(&validated), 2000);
        assert!(excerpt.contains("Nueva reserva"), "{excerpt}");
        assert!(excerpt.contains("Cliente"), "{excerpt}");
        assert!(excerpt.contains("origen persisted"), "{excerpt}");
        assert!(excerpt.contains("origen temporary"), "{excerpt}");
        assert!(excerpt.contains("Confirmar"), "{excerpt}");
    }

    #[test]
    fn excerpt_of_corrupt_content_is_honest() {
        let excerpt = render_mockup_excerpt("no es json", 2000);
        assert!(excerpt.contains("no estructurado"), "{excerpt}");
    }

    #[test]
    fn summary_counts_screens_and_components() {
        let validated = validate_mockup_value(&reserva(), &["req-1".to_string()]).expect("válido");
        let summary = summarize_mockup(&validated);
        assert!(summary.contains("1 pantalla"), "{summary}");
        assert!(summary.contains("4 componentes"), "{summary}");
    }
}
