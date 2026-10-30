//! Structured mockup contract (living design, stage B).
//!
//! Mockups are person-drawn versioned artifacts: this module defines
//! their initial subset and its authoritative validation in Rust. The
//! canonical JSON is the version content; the visual layout (positions)
//! lives apart, in `design_layouts`, and moving a component never
//! creates a semantic version.
//!
//! ## Subset (documented; not a universal UI builder)
//!
//! Mockup: title and screens with stable identity (`[A-Za-z0-9_]`,
//! unique in the mockup). Each screen: title, named interface states
//! (informative, no per-state variants), components and references.
//!
//! Components (`kind`):
//! - `text`: shown text (`text`).
//! - `field`: field with `label`, optional logical `name`, `field_type`
//!   (`text`, `number`, `date`, `boolean`), `required`, declarative
//!   `validations`, mandatory `origin` and optional `data_ref`
//!   (`artifact/element[.attribute]`).
//! - `selector`: `label`, `options` (0-24), `required` and `origin`.
//! - `button`: `label`, declarative `action_kind` (`navigate`,
//!   `submit`, `open_dialog`, `cancel`, `business`), optional
//!   `operation`, optional `target` and `button_state` (`enabled`,
//!   `disabled`, `loading`, `error`).
//! - `table`: `label`, `columns` (1-12) with per-column types,
//!   example `preview_rows`, `row_actions` and `origin`.
//! - `container`: optional `label`, `children` (ordered children of the
//!   same screen) and `direction` (`vertical`, `horizontal`). No
//!   container nesting: the hierarchy is flat.
//! - `icon`: `icon` from the own catalog, `icon_role` (`decorative`,
//!   `button`, `indicator`), accessible label, optional `tooltip` and
//!   an optional action like a button.
//!
//! `origin` declares where the data comes from and is mandatory:
//! `persisted`, `calculated`, `temporary`, `external` or `undefined`. A
//! visual field does NOT imply a database column: nothing creates tables
//! or columns by silent assumption. A screen does NOT equal an entity
//! or class.
//!
//! Compatibility: earlier content is accepted and normalized without
//! rewriting versions. `validation` (text) reads as one validation;
//! `action` (free text) reads as a business operation (or as the
//! declarative action when it matches). The canonical form only emits
//! the new keys.
//!
//! Explicit references (semantic, informative links):
//! - `requirements`: requirement identifiers from the declared set.
//! - `designs`: `artifact/element` pairs (`flujo-1/inicio`) whose artifact
//!   belongs to the declared set and whose element uses the identifier
//!   alphabet. They signal intent, not core generation dependencies:
//!   they take part in no forbidden cycles nor currency computation. The
//!   real dependency (exact version used) is recorded apart, at version
//!   level, as with the other designs.
//!
//! Every reference must belong to the declared set (`allowed`): the rest
//! is rejected. Component identifiers are unique across the whole
//! mockup: the layout map is flat per version (key = the component id).
//! The canvas edits one screen at a time.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::design::{invalid, non_empty, string_field, valid_id};
use crate::error::{redact, MetaError, MetaErrorKind};
use crate::generation::{
    GenerationContextItem, MAX_BODY_BYTES, MAX_CONTEXT_CONTENT_CHARS, MAX_CONTEXT_ITEMS,
    MAX_ITEM_CHARS, MAX_TEMP_ID_CHARS,
};
use crate::protocol::{classify_transport, parse_error, parse_success_capped, TokenUsage};

/// Subset limits.
pub const MAX_MOCKUP_SCREENS: usize = 12;
pub const MAX_MOCKUP_COMPONENTS: usize = 40;
pub const MAX_MOCKUP_OPTIONS: usize = 24;
pub const MAX_MOCKUP_COLUMNS: usize = 12;
pub const MAX_MOCKUP_TITLE_CHARS: usize = 200;
pub const MAX_MOCKUP_LABEL_CHARS: usize = 160;
pub const MAX_MOCKUP_TEXT_CHARS: usize = 1000;
pub const MAX_MOCKUP_VALIDATION_CHARS: usize = 500;
pub const MAX_MOCKUP_REFS: usize = 8;
pub const MAX_MOCKUP_CHILDREN: usize = 40;
pub const MAX_MOCKUP_STATES: usize = 8;
pub const MAX_MOCKUP_VALIDATIONS: usize = 8;
pub const MAX_MOCKUP_PREVIEW_ROWS: usize = 5;
pub const MAX_MOCKUP_ROW_ACTIONS: usize = 8;

/// Component kind of the subset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupComponentKind {
    Text,
    Field,
    Selector,
    Button,
    Table,
    Container,
    Icon,
}

/// Declarative action of a button or action icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupActionKind {
    Navigate,
    Submit,
    OpenDialog,
    Cancel,
    Business,
}

impl MockupActionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Navigate => "navigate",
            Self::Submit => "submit",
            Self::OpenDialog => "open_dialog",
            Self::Cancel => "cancel",
            Self::Business => "business",
        }
    }
}

/// Visual state of a button or action icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupButtonState {
    Enabled,
    Disabled,
    Loading,
    Error,
}

/// Container direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupDirection {
    Vertical,
    Horizontal,
}

/// Icon function: adornment, action trigger or indicator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupIconRole {
    Decorative,
    Button,
    Indicator,
}

/// Own icon catalog: original geometric drawings of the project (see
/// `MockupIcons` in the frontend), no third-party assets. The identifier
/// is stored, never arbitrary SVG. An off-catalog icon is rejected with
/// an explicit error (no silent substitute).
pub const MOCKUP_ICONS: &[&str] = &[
    "home",
    "search",
    "plus",
    "edit",
    "trash",
    "check",
    "x",
    "chevron_up",
    "chevron_down",
    "chevron_left",
    "chevron_right",
    "arrow_left",
    "arrow_right",
    "user",
    "settings",
    "menu",
    "bell",
    "info",
    "warning",
    "error",
    "save",
    "folder",
    "file",
    "calendar",
    "clock",
    "filter",
    "refresh",
    "download",
    "upload",
    "eye",
    "lock",
];

pub fn valid_mockup_icon(id: &str) -> bool {
    MOCKUP_ICONS.contains(&id)
}

/// Visual field data type. It is presentation, not a database schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockupFieldType {
    Text,
    Number,
    Date,
    Boolean,
}

/// Declared origin of visual data. Mandatory: silence cannot mean
/// "persisted".
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

/// Named interface state of a screen. Informative: this milestone has
/// no per-state variants (see scope).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MockupScreenState {
    pub id: String,
    pub label: String,
}

/// Field order is the canonical JSON key order (the frontend mirrors
/// it to compare drafts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MockupComponent {
    pub id: String,
    pub kind: MockupComponentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_type: Option<MockupFieldType>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validations: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub column_types: Vec<MockupFieldType>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preview_rows: Vec<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_actions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_kind: Option<MockupActionKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button_state: Option<MockupButtonState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<MockupOrigin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_role: Option<MockupIconRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<MockupDirection>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub states: Vec<MockupScreenState>,
    pub components: Vec<MockupComponent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedMockup {
    pub title: String,
    pub screens: Vec<MockupScreen>,
}

/// Validates a value as a mockup. `allowed` are the artifact identifiers
/// declared as sources: every reference must belong to the set. Rejects
/// without creating anything on invalid fields, duplicate ids, missing
/// destinations, absent origins or out-of-set references.
pub fn validate_mockup_value(
    value: &serde_json::Value,
    allowed: &[String],
) -> Result<ValidatedMockup, MetaError> {
    if let Some(kind) = value.get("kind").and_then(|v| v.as_str()) {
        if kind != "mockup" {
            return Err(invalid(format!("unexpected kind: {kind}")));
        }
    }
    let title = string_field(value, "title")
        .and_then(|t| non_empty(&t, MAX_MOCKUP_TITLE_CHARS))
        .ok_or_else(|| invalid("mockup without a title"))?;
    let screens = value
        .get("screens")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("mockup without a screen list"))?;
    if screens.len() > MAX_MOCKUP_SCREENS {
        return Err(invalid(format!(
            "too many screens: {} (max {MAX_MOCKUP_SCREENS})",
            screens.len()
        )));
    }
    // Zero screens is a valid blank canvas: the editor creates the
    // artifact and the person draws afterwards.
    let mut seen_screens = std::collections::HashSet::new();
    let mut seen_components = std::collections::HashSet::new();
    let mut out_screens = Vec::with_capacity(screens.len());
    for (i, screen) in screens.iter().enumerate() {
        let n = i + 1;
        let id = string_field(screen, "id")
            .filter(|id| valid_id(id))
            .ok_or_else(|| invalid(format!("screen {n}: invalid identifier")))?;
        if !seen_screens.insert(id.clone()) {
            return Err(invalid(format!("screen {n}: duplicate identifier")));
        }
        let screen_title = string_field(screen, "title")
            .and_then(|t| non_empty(&t, MAX_MOCKUP_TITLE_CHARS))
            .ok_or_else(|| invalid(format!("screen {n}: empty or oversized title")))?;
        let requirements = ref_list(screen, "requirements", n, allowed, "screen")?;
        let designs = design_refs(screen, n, allowed, "screen")?;
        let states = screen_states(screen, n)?;
        let components = screen
            .get("components")
            .and_then(|v| v.as_array())
            .ok_or_else(|| invalid(format!("screen {n}: missing component list")))?;
        if components.len() > MAX_MOCKUP_COMPONENTS {
            return Err(invalid(format!(
                "screen {n}: too many components (max {MAX_MOCKUP_COMPONENTS})"
            )));
        }
        let mut out_components = Vec::with_capacity(components.len());
        for (j, component) in components.iter().enumerate() {
            let m = j + 1;
            let cid = string_field(component, "id")
                .filter(|id| valid_id(id))
                .ok_or_else(|| invalid(format!("screen {n} component {m}: invalid identifier")))?;
            if !seen_components.insert(cid.clone()) {
                return Err(invalid(format!(
                    "screen {n} component {m}: duplicate identifier in the mockup"
                )));
            }
            out_components.push(parse_component(component, n, m, allowed)?);
        }
        out_screens.push(MockupScreen {
            id,
            title: screen_title,
            requirements,
            designs,
            states,
            components: out_components,
        });
    }
    // Second pass (screens and components now known): existing
    // navigation destinations and coherent containers.
    for screen in &out_screens {
        check_targets(screen, &seen_screens)?;
        check_children(screen)?;
    }
    Ok(ValidatedMockup {
        title,
        screens: out_screens,
    })
}

/// Interface states of a screen: informative, with screen-unique
/// identity. Missing equals empty.
fn screen_states(
    screen: &serde_json::Value,
    n: usize,
) -> Result<Vec<MockupScreenState>, MetaError> {
    let Some(node) = screen.get("states") else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    };
    let values = node
        .as_array()
        .ok_or_else(|| invalid(format!("screen {n}: states is not a list")))?;
    if values.len() > MAX_MOCKUP_STATES {
        return Err(invalid(format!(
            "screen {n}: too many states (max {MAX_MOCKUP_STATES})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for (i, value) in values.iter().enumerate() {
        let tag = format!("screen {n} state {}", i + 1);
        let id = string_field(value, "id")
            .filter(|id| valid_id(id))
            .ok_or_else(|| invalid(format!("{tag}: invalid identifier")))?;
        if !seen.insert(id.clone()) {
            return Err(invalid(format!("{tag}: duplicate identifier")));
        }
        let label = string_field(value, "label")
            .and_then(|t| non_empty(&t, MAX_MOCKUP_LABEL_CHARS))
            .ok_or_else(|| invalid(format!("{tag}: empty or oversized label")))?;
        out.push(MockupScreenState { id, label });
    }
    Ok(out)
}

/// Navigation destinations: with a `navigate` action (or action-less
/// with a destination, the legacy shape) they must be existing screens.
/// With other actions the destination is an opaque reference (dialog,
/// operation): the alphabet suffices, checked at parse time.
fn check_targets(
    screen: &MockupScreen,
    screens: &std::collections::HashSet<String>,
) -> Result<(), MetaError> {
    for component in &screen.components {
        let Some(target) = &component.target else {
            continue;
        };
        let navigates = component
            .action_kind
            .is_none_or(|k| k == MockupActionKind::Navigate);
        if navigates && !screens.contains(target) {
            return Err(invalid(format!(
                "screen {} component {}: missing destination ({target})",
                screen.id, component.id
            )));
        }
    }
    Ok(())
}

/// Container children: they exist on the same screen, no repeats, no
/// self-containment, no nested containers and a single parent per
/// component. The hierarchy is flat on purpose.
fn check_children(screen: &MockupScreen) -> Result<(), MetaError> {
    let kinds: std::collections::HashMap<&str, MockupComponentKind> = screen
        .components
        .iter()
        .map(|c| (c.id.as_str(), c.kind))
        .collect();
    let mut parented = std::collections::HashSet::new();
    for component in &screen.components {
        if component.children.is_empty() {
            continue;
        }
        if component.kind != MockupComponentKind::Container {
            return Err(invalid(format!(
                "screen {} component {}: only containers group",
                screen.id, component.id
            )));
        }
        let mut seen = std::collections::HashSet::new();
        for child in &component.children {
            if child == &component.id {
                return Err(invalid(format!(
                    "screen {} component {}: cannot contain itself",
                    screen.id, component.id
                )));
            }
            let Some(kind) = kinds.get(child.as_str()) else {
                return Err(invalid(format!(
                    "screen {} component {}: missing child ({child})",
                    screen.id, component.id
                )));
            };
            if *kind == MockupComponentKind::Container {
                return Err(invalid(format!(
                    "screen {} component {}: no nested containers",
                    screen.id, component.id
                )));
            }
            if !seen.insert(child.clone()) {
                return Err(invalid(format!(
                    "screen {} component {}: repeated child ({child})",
                    screen.id, component.id
                )));
            }
            if !parented.insert(child.clone()) {
                return Err(invalid(format!(
                    "screen {} component {}: {child} already has a container",
                    screen.id, component.id
                )));
            }
        }
    }
    Ok(())
}

fn parse_component(
    component: &serde_json::Value,
    n: usize,
    m: usize,
    allowed: &[String],
) -> Result<MockupComponent, MetaError> {
    let id = string_field(component, "id")
        .filter(|id| valid_id(id))
        .ok_or_else(|| invalid(format!("screen {n} component {m}: invalid identifier")))?;
    let kind: MockupComponentKind = component
        .get("kind")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| invalid(format!("screen {n} component {m}: invalid kind")))?;
    let tag = format!("screen {n} component {m}");
    let label = match component.get("label") {
        None | Some(serde_json::Value::Null) => None,
        Some(_) => Some(
            string_field(component, "label")
                .and_then(|t| non_empty(&t, MAX_MOCKUP_LABEL_CHARS))
                .ok_or_else(|| invalid(format!("{tag}: empty or oversized label")))?,
        ),
    };
    let requirements = ref_list(component, "requirements", m, allowed, &tag)?;
    let designs = design_refs(component, m, allowed, &tag)?;
    let mut out = MockupComponent {
        id,
        kind,
        text: None,
        label,
        name: None,
        field_type: None,
        required: component
            .get("required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        validations: Vec::new(),
        data_ref: None,
        options: Vec::new(),
        columns: Vec::new(),
        column_types: Vec::new(),
        preview_rows: Vec::new(),
        row_actions: Vec::new(),
        action_kind: None,
        operation: None,
        target: None,
        button_state: None,
        origin: None,
        icon: None,
        icon_role: None,
        tooltip: None,
        children: Vec::new(),
        direction: None,
        requirements,
        designs,
    };
    match kind {
        MockupComponentKind::Text => {
            out.text = Some(
                string_field(component, "text")
                    .and_then(|t| non_empty(&t, MAX_MOCKUP_TEXT_CHARS))
                    .ok_or_else(|| invalid(format!("{tag}: empty or oversized text")))?,
            );
        }
        MockupComponentKind::Field => {
            require_label(&out, &tag)?;
            out.name = match component.get("name") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => Some(
                    string_field(component, "name")
                        .filter(|id| valid_id(id))
                        .ok_or_else(|| invalid(format!("{tag}: invalid logical name")))?,
                ),
            };
            out.field_type = Some(
                component
                    .get("field_type")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .ok_or_else(|| invalid(format!("{tag}: invalid field type")))?,
            );
            out.validations = parse_validations(component, &tag)?;
            out.data_ref = parse_data_ref(component, &tag, allowed)?;
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
            parse_action(component, &tag, &mut out)?;
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
                    "{tag}: the table needs at least one column"
                )));
            }
            out.column_types = parse_column_types(component, &tag, out.columns.len())?;
            out.preview_rows = parse_preview_rows(component, &tag, out.columns.len())?;
            out.row_actions = string_list(
                component,
                "row_actions",
                &tag,
                MAX_MOCKUP_ROW_ACTIONS,
                MAX_MOCKUP_LABEL_CHARS,
            )?;
            out.origin = Some(require_origin(component, &tag)?);
        }
        MockupComponentKind::Container => {
            out.children = parse_children(component, &tag)?;
            out.direction = match component.get("direction") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => {
                    let direction: MockupDirection = serde_json::from_value(
                        component
                            .get("direction")
                            .expect("direction present")
                            .clone(),
                    )
                    .map_err(|_| invalid(format!("{tag}: invalid direction")))?;
                    // The canonical form omits the default value.
                    if direction == MockupDirection::Vertical {
                        None
                    } else {
                        Some(direction)
                    }
                }
            };
        }
        MockupComponentKind::Icon => {
            require_label(&out, &tag)?;
            let icon = string_field(component, "icon")
                .ok_or_else(|| invalid(format!("{tag}: missing icon")))?;
            if !valid_mockup_icon(&icon) {
                return Err(invalid(format!(
                    "{tag}: disallowed icon ({icon}): pick one from the catalog"
                )));
            }
            out.icon = Some(icon);
            out.icon_role = match component.get("icon_role") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => {
                    let role: MockupIconRole = serde_json::from_value(
                        component.get("icon_role").expect("role present").clone(),
                    )
                    .map_err(|_| invalid(format!("{tag}: invalid icon role")))?;
                    if role == MockupIconRole::Decorative {
                        None
                    } else {
                        Some(role)
                    }
                }
            };
            out.tooltip = match component.get("tooltip") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => Some(
                    string_field(component, "tooltip")
                        .and_then(|t| non_empty(&t, MAX_MOCKUP_LABEL_CHARS))
                        .ok_or_else(|| invalid(format!("{tag}: empty or oversized tooltip")))?,
                ),
            };
            parse_action(component, &tag, &mut out)?;
        }
    }
    Ok(out)
}

/// Declarative validations of a field. The new key (`validations`,
/// list) wins; the legacy one (`validation`, text) is accepted as a
/// single item to avoid breaking earlier content.
fn parse_validations(component: &serde_json::Value, tag: &str) -> Result<Vec<String>, MetaError> {
    if component.get("validations").is_some() {
        return string_list(
            component,
            "validations",
            tag,
            MAX_MOCKUP_VALIDATIONS,
            MAX_MOCKUP_VALIDATION_CHARS,
        );
    }
    match component.get("validation") {
        None | Some(serde_json::Value::Null) => Ok(Vec::new()),
        Some(_) => {
            let legacy = string_field(component, "validation")
                .and_then(|t| non_empty(&t, MAX_MOCKUP_VALIDATION_CHARS))
                .ok_or_else(|| invalid(format!("{tag}: empty or oversized validation")))?;
            Ok(vec![legacy])
        }
    }
}

/// Data reference of a field: `artifact/element` or
/// `artifact/element.attribute`, with the artifact in the declared set.
/// It signals where the data comes from without creating dependencies.
fn parse_data_ref(
    component: &serde_json::Value,
    tag: &str,
    allowed: &[String],
) -> Result<Option<String>, MetaError> {
    let raw = match component.get("data_ref") {
        None | Some(serde_json::Value::Null) => return Ok(None),
        Some(_) => string_field(component, "data_ref")
            .ok_or_else(|| invalid(format!("{tag}: non-text data_ref")))?,
    };
    let (artifact, rest) = raw.split_once('/').ok_or_else(|| {
        invalid(format!(
            "{tag}: data_ref without artifact/element shape ({raw})"
        ))
    })?;
    if !allowed.contains(&artifact.to_string()) {
        return Err(invalid(format!("{tag}: data_ref outside the set ({raw})")));
    }
    let mut parts = rest.split('.');
    let element = parts.next().unwrap_or_default();
    if !valid_id(element) {
        return Err(invalid(format!("{tag}: invalid data_ref ({raw})")));
    }
    match (parts.next(), parts.next()) {
        (None, _) => {}
        (Some(attribute), None) if valid_id(attribute) => {}
        _ => {
            return Err(invalid(format!("{tag}: invalid data_ref ({raw})")));
        }
    }
    Ok(Some(raw))
}

/// Action of a button or action icon. The new key (`action_kind`)
/// wins; the legacy one (`action`, free text) reads as the declarative
/// action when it matches, or as a business operation otherwise.
fn parse_action(
    component: &serde_json::Value,
    tag: &str,
    out: &mut MockupComponent,
) -> Result<(), MetaError> {
    let mut kind: Option<MockupActionKind> = match component.get("action_kind") {
        None | Some(serde_json::Value::Null) => None,
        Some(_) => Some(
            serde_json::from_value(
                component
                    .get("action_kind")
                    .expect("action present")
                    .clone(),
            )
            .map_err(|_| invalid(format!("{tag}: invalid action")))?,
        ),
    };
    let mut operation = match component.get("operation") {
        None | Some(serde_json::Value::Null) => None,
        Some(_) => Some(
            string_field(component, "operation")
                .and_then(|t| non_empty(&t, MAX_MOCKUP_LABEL_CHARS))
                .ok_or_else(|| invalid(format!("{tag}: empty or oversized operation")))?,
        ),
    };
    if kind.is_none() && operation.is_none() {
        if let Some(raw) = string_field(component, "action") {
            let text = non_empty(&raw, MAX_MOCKUP_LABEL_CHARS)
                .ok_or_else(|| invalid(format!("{tag}: empty or oversized action")))?;
            kind = serde_json::from_value(serde_json::Value::String(text.clone())).ok();
            if kind.is_none() {
                operation = Some(text);
            }
        }
    }
    out.action_kind = kind;
    out.operation = operation;
    out.target = match component.get("target") {
        None | Some(serde_json::Value::Null) => None,
        Some(_) => Some(
            string_field(component, "target")
                .filter(|id| valid_id(id))
                .ok_or_else(|| invalid(format!("{tag}: invalid destination")))?,
        ),
    };
    out.button_state = match component.get("button_state") {
        None | Some(serde_json::Value::Null) => None,
        Some(_) => {
            let state: MockupButtonState = serde_json::from_value(
                component
                    .get("button_state")
                    .expect("state present")
                    .clone(),
            )
            .map_err(|_| invalid(format!("{tag}: invalid state")))?;
            if state == MockupButtonState::Enabled {
                None
            } else {
                Some(state)
            }
        }
    };
    Ok(())
}

/// Per-column types: missing (all text) or one per column.
fn parse_column_types(
    component: &serde_json::Value,
    tag: &str,
    columns: usize,
) -> Result<Vec<MockupFieldType>, MetaError> {
    let Some(node) = component.get("column_types") else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    }
    let values = node
        .as_array()
        .ok_or_else(|| invalid(format!("{tag}: column_types is not a list")))?;
    if values.len() != columns {
        return Err(invalid(format!(
            "{tag}: column_types brings {} types for {columns} columns",
            values.len()
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        out.push(
            serde_json::from_value(value.clone())
                .map_err(|_| invalid(format!("{tag}: invalid column type")))?,
        );
    }
    Ok(out)
}

/// Example rows for the preview: declared fiction, never real logs.
/// Each row brings at most one cell per column.
fn parse_preview_rows(
    component: &serde_json::Value,
    tag: &str,
    columns: usize,
) -> Result<Vec<Vec<String>>, MetaError> {
    let Some(node) = component.get("preview_rows") else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    }
    let rows = node
        .as_array()
        .ok_or_else(|| invalid(format!("{tag}: preview_rows is not a list")))?;
    if rows.len() > MAX_MOCKUP_PREVIEW_ROWS {
        return Err(invalid(format!(
            "{tag}: too many example rows (max {MAX_MOCKUP_PREVIEW_ROWS})"
        )));
    }
    let mut out = Vec::with_capacity(rows.len());
    for (i, row) in rows.iter().enumerate() {
        let cells = row
            .as_array()
            .ok_or_else(|| invalid(format!("{tag}: row {} is not a list", i + 1)))?;
        if cells.len() > columns {
            return Err(invalid(format!(
                "{tag}: row {} brings more cells than columns",
                i + 1
            )));
        }
        let mut parsed = Vec::with_capacity(cells.len());
        for cell in cells {
            let text = cell
                .as_str()
                .ok_or_else(|| invalid(format!("{tag}: non-text cell")))?;
            parsed.push(
                non_empty(text, MAX_MOCKUP_LABEL_CHARS)
                    .ok_or_else(|| invalid(format!("{tag}: empty or oversized cell")))?,
            );
        }
        out.push(parsed);
    }
    Ok(out)
}

/// Container children: alphabet identifiers; existence and coherence
/// are checked on the second pass.
fn parse_children(component: &serde_json::Value, tag: &str) -> Result<Vec<String>, MetaError> {
    let Some(node) = component.get("children") else {
        return Ok(Vec::new());
    };
    if node.is_null() {
        return Ok(Vec::new());
    }
    let values = node
        .as_array()
        .ok_or_else(|| invalid(format!("{tag}: children is not a list")))?;
    if values.len() > MAX_MOCKUP_CHILDREN {
        return Err(invalid(format!(
            "{tag}: too many children (max {MAX_MOCKUP_CHILDREN})"
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let id = value
            .as_str()
            .filter(|id| valid_id(id))
            .ok_or_else(|| invalid(format!("{tag}: invalid child")))?;
        out.push(id.to_string());
    }
    Ok(out)
}

fn require_label(out: &MockupComponent, tag: &str) -> Result<(), MetaError> {
    if out.label.is_none() {
        return Err(invalid(format!("{tag}: missing label")));
    }
    Ok(())
}

fn require_origin(component: &serde_json::Value, tag: &str) -> Result<MockupOrigin, MetaError> {
    component
        .get("origin")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| {
            invalid(format!(
                "{tag}: missing data origin (persisted, calculated, temporary, external or undefined)"
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
        .ok_or_else(|| invalid(format!("{tag}: {name} is not a list")))?;
    if values.len() > max_items {
        return Err(invalid(format!(
            "{tag}: too many items in {name} (max {max_items})"
        )));
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let text = value
            .as_str()
            .ok_or_else(|| invalid(format!("{tag}: non-text {name}")))?;
        out.push(
            non_empty(text, max_chars)
                .ok_or_else(|| invalid(format!("{tag}: empty or oversized {name}")))?,
        );
    }
    Ok(out)
}

/// Requirement references: inside the declared set, no duplicates, with
/// a cap. Missing equals empty (the canonical form omits empty ones).
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
        .ok_or_else(|| invalid(format!("{what} {n}: {name} is not a list")))?;
    if values.len() > MAX_MOCKUP_REFS {
        return Err(invalid(format!(
            "{what} {n}: too many references (max {MAX_MOCKUP_REFS})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let id = value
            .as_str()
            .ok_or_else(|| invalid(format!("{what} {n}: non-text reference")))?;
        if !allowed.contains(&id.to_string()) {
            return Err(invalid(format!(
                "{what} {n}: reference outside the set ({id})"
            )));
        }
        if !seen.insert(id.to_string()) {
            return Err(invalid(format!("{what} {n}: duplicate reference ({id})")));
        }
        out.push(id.to_string());
    }
    Ok(out)
}

/// References to design elements (`artifact/element`): the artifact must
/// belong to the declared set; the element uses the identifier alphabet.
/// They are informative semantic links, not core dependencies: they
/// create no cycles or currency.
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
        .ok_or_else(|| invalid(format!("{what} {n}: designs is not a list")))?;
    if values.len() > MAX_MOCKUP_REFS {
        return Err(invalid(format!(
            "{what} {n}: too many references (max {MAX_MOCKUP_REFS})"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let raw = value
            .as_str()
            .ok_or_else(|| invalid(format!("{what} {n}: non-text reference")))?;
        let (artifact, element) = raw.split_once('/').ok_or_else(|| {
            invalid(format!(
                "{what} {n}: reference without artifact/element shape ({raw})"
            ))
        })?;
        if artifact.is_empty() || !valid_id(element) {
            return Err(invalid(format!("{what} {n}: invalid reference ({raw})")));
        }
        if !allowed.contains(&artifact.to_string()) {
            return Err(invalid(format!(
                "{what} {n}: reference outside the set ({raw})"
            )));
        }
        if !seen.insert(raw.to_string()) {
            return Err(invalid(format!("{what} {n}: duplicate reference ({raw})")));
        }
        out.push(raw.to_string());
    }
    Ok(out)
}

/// Authoritative canonical content: fixed serialization of the validated.
pub fn canonical_mockup_json(mockup: &ValidatedMockup) -> String {
    let mut map = serde_json::Map::new();
    map.insert("title".to_string(), serde_json::json!(mockup.title));
    map.insert("kind".to_string(), serde_json::json!("mockup"));
    map.insert("screens".to_string(), serde_json::json!(mockup.screens));
    serde_json::to_string(&map).expect("validated mockup always serializes")
}

/// Readable summary of a saved mockup for use as design-generation
/// context: screens with their components (kind, label and origin), no
/// positions. When the content does not parse (hand-corrupted), returns
/// an honest marker instead of inventing.
/// Revalidates SAVED content without knowing the original declared
/// set (references resolve at use time, not here). `None` when the
/// content is not a valid mockup.
pub fn parse_mockup_spec(spec_json: &str) -> Option<ValidatedMockup> {
    let value = serde_json::from_str::<serde_json::Value>(spec_json).ok()?;
    validate_mockup_value(&value, &refs_of(&value)).ok()
}

fn render_screen(screen: &MockupScreen) -> String {
    let mut out = format!("Screen {} ({})\n", screen.id, screen.title);
    for component in &screen.components {
        out.push_str(&format!("- {}\n", describe_component(component)));
    }
    out
}

fn truncate_end(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim_end().to_string();
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

pub fn render_mockup_excerpt(spec_json: &str, max_chars: usize) -> String {
    let fallback = "(mockup with unstructured content)".to_string();
    let Some(validated) = parse_mockup_spec(spec_json) else {
        return fallback;
    };
    let mut out = format!("Mockup: {}\n", validated.title);
    for screen in &validated.screens {
        out.push_str(&render_screen(screen));
    }
    truncate_end(&out, max_chars)
}

/// Summary of ONE saved screen for use as a code-proposal origin:
/// components with kind, label and origin, no positions. `None` when the
/// content does not validate or the screen does not exist (the api turns
/// it into an honest error, never invents).
pub fn render_mockup_screen_excerpt(
    spec_json: &str,
    screen_id: &str,
    max_chars: usize,
) -> Option<String> {
    let validated = parse_mockup_spec(spec_json)?;
    let screen = validated.screens.iter().find(|s| s.id == screen_id)?;
    Some(truncate_end(&render_screen(screen), max_chars))
}

/// References cited in the content: allows revalidating the saved data
/// without knowing the original declared set (as with designs).
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
                "text {}: {}",
                component.id,
                component.text.as_deref().unwrap_or("")
            )
        }
        MockupComponentKind::Field => format!(
            "field {} \"{}\" ({}, {}{})",
            component.id,
            label,
            component.field_type.map(field_type_str).unwrap_or("?"),
            if component.required {
                "required"
            } else {
                "optional"
            },
            component
                .origin
                .map(|o| format!(", origin {}", o.as_str()))
                .unwrap_or_default(),
        ),
        MockupComponentKind::Selector => format!(
            "selector {} \"{}\" ({} options{})",
            component.id,
            label,
            component.options.len(),
            component
                .origin
                .map(|o| format!(", origin {}", o.as_str()))
                .unwrap_or_default(),
        ),
        MockupComponentKind::Button => {
            format!(
                "button {} \"{}\"{}",
                component.id,
                label,
                describe_action(component)
            )
        }
        MockupComponentKind::Table => format!(
            "table {} \"{}\" ({} columns{})",
            component.id,
            label,
            component.columns.len(),
            component
                .origin
                .map(|o| format!(", origin {}", o.as_str()))
                .unwrap_or_default(),
        ),
        MockupComponentKind::Container => {
            if component.children.is_empty() {
                format!("container {} \"{}\" (empty)", component.id, label)
            } else {
                format!(
                    "container {} \"{}\" ({}: {})",
                    component.id,
                    label,
                    match component.direction {
                        Some(MockupDirection::Horizontal) => "horizontal",
                        _ => "vertical",
                    },
                    component.children.join(", "),
                )
            }
        }
        MockupComponentKind::Icon => {
            format!(
                "icon {} \"{}\" ({}{})",
                component.id,
                label,
                component.icon.as_deref().unwrap_or("?"),
                describe_action(component),
            )
        }
    }
}

/// Action and destination of a button or action icon, in parentheses
/// or empty when there is nothing to tell.
fn describe_action(component: &MockupComponent) -> String {
    let mut extra = String::new();
    if let Some(kind) = &component.action_kind {
        extra.push_str(kind.as_str());
    }
    if let Some(operation) = &component.operation {
        if !extra.is_empty() {
            extra.push(' ');
        }
        extra.push_str(operation);
    }
    if let Some(target) = &component.target {
        if !extra.is_empty() {
            extra.push_str(", ");
        }
        extra.push_str(&format!("goes to {target}"));
    }
    if extra.is_empty() {
        String::new()
    } else {
        format!(" ({extra})")
    }
}

/// Structured summary of a validated mockup for spec and export:
/// screens with their components in order. Deterministic.
pub fn summarize_mockup(mockup: &ValidatedMockup) -> String {
    let total: usize = mockup.screens.iter().map(|s| s.components.len()).sum();
    let mut out = format!(
        "Mockup: {} {}, {} {}.\n",
        mockup.screens.len(),
        plural(mockup.screens.len(), "screen", "screens"),
        total,
        plural(total, "component", "components"),
    );
    for screen in &mockup.screens {
        out.push_str(&format!(
            "\nScreen {} ({}): {} {}.\n",
            screen.id,
            screen.title,
            screen.components.len(),
            plural(screen.components.len(), "component", "components"),
        ));
        for component in &screen.components {
            out.push_str(&format!("- {}\n", describe_component(component)));
        }
    }
    out.push('\n');
    out
}

fn plural<'a>(count: usize, one: &'a str, many: &'a str) -> &'a str {
    if count == 1 {
        one
    } else {
        many
    }
}

fn field_type_str(kind: MockupFieldType) -> &'static str {
    match kind {
        MockupFieldType::Text => "text",
        MockupFieldType::Number => "number",
        MockupFieldType::Date => "date",
        MockupFieldType::Boolean => "boolean",
    }
}

// ---------------------------------------------------------------------------
// Screen proposals with Meta ("Propose screens")
// ---------------------------------------------------------------------------

/// Screen-proposal template version. Bumped to 2 when the instructions
/// were translated to English; v1 rows keep their original Spanish prompt.
pub const MOCKUP_GEN_TEMPLATE_VERSION: u32 = 2;
/// Maximum screens per request (each one is incorporated separately).
pub const MAX_MOCKUP_GEN_SCREENS: usize = 3;
/// Maximum open questions per generation.
pub const MAX_MOCKUP_GEN_QUESTIONS: usize = 5;
/// Total input cap (same as with requirements).
pub const MAX_MOCKUP_GEN_INPUT_CHARS: usize = 50_000;
/// Brief explanation per screen.
pub const MAX_MOCKUP_GEN_EXPLANATION_CHARS: usize = 2000;
/// Output limit: three screens with components take more than eight
/// short requirements.
pub const MOCKUP_GEN_MAX_OUTPUT_TOKENS: u32 = 8192;
/// Own timeout, no retries (like the other generations).
pub const MOCKUP_GEN_TIMEOUT_SECS: u64 = 90;

/// Proposed screen, validated and ready to record. The `temp_id` is the
/// model's temporary one; `spec_json` is the canonical JSON of a ONE-screen
/// mockup, ready to be incorporated as a new artifact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenDraft {
    pub temp_id: String,
    pub title: String,
    pub spec_json: String,
    pub explanation: String,
}

/// Validated result: screens plus open questions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedMockupGeneration {
    pub screens: Vec<ScreenDraft>,
    pub questions: Vec<String>,
}

/// Complete result with call metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockupGenerationResult {
    pub screens: Vec<ScreenDraft>,
    pub questions: Vec<String>,
    pub model: String,
    pub usage: Option<TokenUsage>,
}

const SCREENS_INSTRUCTION: &str = "You are a designer proposing interface screens from saved requirements. \
Reply ONLY with the requested JSON object, no extra text. \
Propose between 1 and 3 screens: each one needs temp_id (short, unique, letters, digits, hyphen and underscore only), title, spec (the screen: unique id of letters, digits and underscore, title, requirements with identifiers of the sent context, optional states and components) and a brief explanation. \
Components (kind): text (text), field (label, field_type among text, number, date and boolean, required, validations, MANDATORY origin among persisted, calculated, temporary and external or undefined), selector (label, options, required, origin), button (label, action_kind among navigate, submit, open_dialog, cancel and business, optional operation or target), table (label, columns, origin), container (label, children with children of the same screen) and icon (label, icon from the catalog: home, search, plus, edit, trash, check, x, chevron_up, chevron_down, chevron_left, chevron_right, arrow_left, arrow_right, user, settings, menu, bell, info, warning, error, save, folder, file, calendar, clock, filter, refresh, download, upload, eye, lock). \
A visual field is NOT a column nor a screen an entity: declare origin undefined when you do not know. \
Do not invent endpoints, security rules or approved decisions; flag ambiguities in questions (at most 5).";

/// Builds the text sent to the model: only the module's saved
/// requirements (the first by identifier, trimmed), with a total cap.
pub fn build_mockup_generation_input(context: &[GenerationContextItem]) -> String {
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
        let input = format!(
            "{SCREENS_INSTRUCTION}\n\nSaved requirements (context; {}):\n{}",
            rendered.len(),
            rendered.join("\n\n")
        );
        if input.chars().count() <= MAX_MOCKUP_GEN_INPUT_CHARS || rendered.is_empty() {
            return input;
        }
        rendered.pop();
    }
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

/// JSON schema sent in `text.format`. Pins shape and count caps;
/// lengths, uniqueness, catalog and references are enforced on
/// validation in Rust with `validate_mockup_value`.
pub fn mockup_generation_json_schema() -> serde_json::Value {
    let id_string = || serde_json::json!({ "type": "string" });
    let ref_list = || {
        serde_json::json!({
            "type": "array", "maxItems": MAX_MOCKUP_REFS, "items": { "type": "string" }
        })
    };
    let state_list = || {
        serde_json::json!({
            "type": "array", "maxItems": MAX_MOCKUP_STATES,
            "items": {
                "type": "object",
                "properties": { "id": id_string(), "label": { "type": "string" } },
                "required": ["id", "label"],
                "additionalProperties": false
            }
        })
    };
    let component = serde_json::json!({
        "type": "object",
        "properties": {
            "id": id_string(),
            "kind": { "type": "string" },
            "text": { "type": "string" },
            "label": { "type": "string" },
            "name": { "type": "string" },
            "field_type": { "type": "string" },
            "required": { "type": "boolean" },
            "validations": { "type": "array", "maxItems": MAX_MOCKUP_VALIDATIONS, "items": { "type": "string" } },
            "data_ref": { "type": "string" },
            "options": { "type": "array", "maxItems": MAX_MOCKUP_OPTIONS, "items": { "type": "string" } },
            "columns": { "type": "array", "maxItems": MAX_MOCKUP_COLUMNS, "items": { "type": "string" } },
            "column_types": { "type": "array", "maxItems": MAX_MOCKUP_COLUMNS, "items": { "type": "string" } },
            "preview_rows": { "type": "array", "maxItems": MAX_MOCKUP_PREVIEW_ROWS, "items": { "type": "array", "items": { "type": "string" } } },
            "row_actions": { "type": "array", "maxItems": MAX_MOCKUP_ROW_ACTIONS, "items": { "type": "string" } },
            "action_kind": { "type": "string" },
            "operation": { "type": "string" },
            "target": { "type": "string" },
            "button_state": { "type": "string" },
            "origin": { "type": "string" },
            "icon": { "type": "string" },
            "icon_role": { "type": "string" },
            "tooltip": { "type": "string" },
            "children": { "type": "array", "maxItems": MAX_MOCKUP_CHILDREN, "items": { "type": "string" } },
            "direction": { "type": "string" },
            "requirements": ref_list()
        },
        "required": ["id", "kind"],
        "additionalProperties": false
    });
    serde_json::json!({
        "type": "object",
        "properties": {
            "screens": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_MOCKUP_GEN_SCREENS,
                "items": {
                    "type": "object",
                    "properties": {
                        "temp_id": { "type": "string" },
                        "title": { "type": "string" },
                        "spec": {
                            "type": "object",
                            "properties": {
                                "id": id_string(),
                                "title": { "type": "string" },
                                "requirements": ref_list(),
                                "states": state_list(),
                                "components": {
                                    "type": "array",
                                    "maxItems": MAX_MOCKUP_COMPONENTS,
                                    "items": component
                                }
                            },
                            "required": ["id", "title", "components"],
                            "additionalProperties": false
                        },
                        "explanation": { "type": "string" }
                    },
                    "required": ["temp_id", "title", "spec", "explanation"],
                    "additionalProperties": false
                }
            },
            "questions": {
                "type": "array",
                "maxItems": MAX_MOCKUP_GEN_QUESTIONS,
                "items": { "type": "string" }
            }
        },
        "required": ["screens", "questions"],
        "additionalProperties": false
    })
}

/// Request body: like the other generations, with its schema in
/// `text.format`.
pub fn build_mockup_generation_body(model: &str, input: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "input": input,
        "max_output_tokens": MOCKUP_GEN_MAX_OUTPUT_TOKENS,
        "reasoning": { "effort": "minimal" },
        "store": false,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "mockup_screen_proposals",
                "schema": mockup_generation_json_schema(),
            }
        },
    })
}

/// Validates the model output. Each screen validates as a ONE-screen
/// mockup against the sent set (`allowed`): invalid input rejects ALL
/// the output without creating anything. Zero screens is incomplete
/// output.
pub fn parse_mockup_generation_output(
    text: &str,
    allowed: &[String],
) -> Result<ValidatedMockupGeneration, MetaError> {
    let json = crate::generation::extract_json(text).ok_or_else(|| {
        MetaError::new(
            MetaErrorKind::InvalidResponse,
            "The API returned a generation that is not valid JSON.",
            false,
        )
    })?;
    let screens = json
        .get("screens")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("missing screen list"))?;
    if screens.is_empty() {
        return Err(MetaError::new(
            MetaErrorKind::Incomplete,
            "The API returned a generation without screens.",
            false,
        ));
    }
    if screens.len() > MAX_MOCKUP_GEN_SCREENS {
        return Err(invalid(format!(
            "too many screens: {} (max {MAX_MOCKUP_GEN_SCREENS})",
            screens.len()
        )));
    }
    let questions = json
        .get("questions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| invalid("missing question list"))?;
    if questions.len() > MAX_MOCKUP_GEN_QUESTIONS {
        return Err(invalid(format!(
            "too many questions: {} (max {MAX_MOCKUP_GEN_QUESTIONS})",
            questions.len()
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(screens.len());
    for (i, screen) in screens.iter().enumerate() {
        let n = i + 1;
        let temp_id = screen
            .get("temp_id")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| invalid(format!("screen {n}: missing temp_id or not text")))?;
        if !valid_temp_id(&temp_id) {
            return Err(invalid(format!("screen {n}: invalid temp identifier")));
        }
        if !seen.insert(temp_id.clone()) {
            return Err(invalid(format!("screen {n}: duplicate temp identifier")));
        }
        let title = screen
            .get("title")
            .and_then(|v| v.as_str())
            .and_then(|t| non_empty(t, MAX_MOCKUP_TITLE_CHARS))
            .ok_or_else(|| invalid(format!("screen {n}: empty or oversized title")))?;
        let explanation = screen
            .get("explanation")
            .and_then(|v| v.as_str())
            .and_then(|t| non_empty(t, MAX_MOCKUP_GEN_EXPLANATION_CHARS))
            .ok_or_else(|| invalid(format!("screen {n}: empty or oversized explanation")))?;
        let spec = screen
            .get("spec")
            .ok_or_else(|| invalid(format!("screen {n}: missing screen")))?;
        // The screen travels alone: it validates wrapped as a one-screen
        // mockup and is stored already in canonical form.
        let wrapped = serde_json::json!({ "title": title, "screens": [spec] });
        let validated = validate_mockup_value(&wrapped, allowed)
            .map_err(|err| invalid(format!("screen {n} ({}): {}", temp_id, err.message)))?;
        out.push(ScreenDraft {
            temp_id,
            title,
            spec_json: canonical_mockup_json(&validated),
            explanation,
        });
    }
    let mut qs = Vec::with_capacity(questions.len());
    for (i, question) in questions.iter().enumerate() {
        let text = question
            .as_str()
            .ok_or_else(|| invalid(format!("question {}: not text", i + 1)))?;
        qs.push(
            non_empty(text, MAX_ITEM_CHARS)
                .ok_or_else(|| invalid(format!("question {}: empty or oversized", i + 1)))?,
        );
    }
    Ok(ValidatedMockupGeneration {
        screens: out,
        questions: qs,
    })
}

fn valid_temp_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && id.chars().count() <= MAX_TEMP_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Runs a screen generation: a single POST without retries, with its
/// own timeout and body cap. Same classification as the other calls.
/// `allowed` are the sent artifacts.
pub async fn generate_mockups(
    config: &crate::MetaConfig,
    input: &str,
    allowed: &[String],
) -> Result<MockupGenerationResult, MetaError> {
    let secret = config.api_key.expose();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(MOCKUP_GEN_TIMEOUT_SECS))
        .build()
        .map_err(|err| MetaError::network(&redact(&err.to_string(), secret)))?;

    let response = client
        .post(crate::protocol::RESPONSES_URL)
        .header("Authorization", format!("Bearer {secret}"))
        .json(&build_mockup_generation_body(&config.model, input))
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
    let parsed = parse_success_capped(status, &body, secret, MAX_BODY_BYTES)?;
    let validated = parse_mockup_generation_output(&parsed.text, allowed)
        .map_err(|err| err.with_status(status))?;
    Ok(MockupGenerationResult {
        screens: validated.screens,
        questions: validated.questions,
        model: parsed.model,
        usage: parsed.usage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn booking() -> serde_json::Value {
        serde_json::json!({
            "title": "New booking",
            "screens": [{
                "id": "new_booking",
                "title": "New booking",
                "requirements": ["req-1"],
                "designs": [],
                "components": [
                    {"id": "t1", "kind": "text", "text": "New booking",
                     "requirements": [], "designs": []},
                    {"id": "f_customer", "kind": "field", "label": "Customer",
                     "field_type": "text", "required": true, "origin": "persisted",
                     "requirements": ["req-1"], "designs": []},
                    {"id": "f_quantity", "kind": "field", "label": "Quantity",
                     "field_type": "number", "required": true, "origin": "temporary",
                     "requirements": [], "designs": []},
                    {"id": "b_ok", "kind": "button", "label": "Confirm",
                     "action": "confirm_booking", "requirements": [], "designs": []}
                ]
            }]
        })
    }

    #[test]
    fn valid_mockup_roundtrips_through_canonical() {
        let validated = validate_mockup_value(&booking(), &["req-1".to_string()]).expect("valid");
        assert_eq!(validated.title, "New booking");
        assert_eq!(validated.screens.len(), 1);
        assert_eq!(validated.screens[0].components.len(), 4);
        let canonical = canonical_mockup_json(&validated);
        let reparsed: serde_json::Value = serde_json::from_str(&canonical).expect("json");
        assert_eq!(reparsed["kind"], "mockup");
        let again = validate_mockup_value(&reparsed, &["req-1".to_string()]).expect("revalidates");
        assert_eq!(again, validated);
    }

    #[test]
    fn empty_screens_are_a_valid_blank_canvas() {
        let value = serde_json::json!({"title": "Empty", "screens": []});
        let validated = validate_mockup_value(&value, &[]).expect("blank canvas");
        assert!(validated.screens.is_empty());
    }

    #[test]
    fn duplicate_screen_ids_rejected() {
        let mut value = booking();
        value["screens"]
            .as_array_mut()
            .expect("list")
            .push(serde_json::json!({
                "id": "new_booking", "title": "Duplicate",
                "requirements": [], "designs": [], "components": []
            }));
        let err = validate_mockup_value(&value, &["req-1".to_string()]).expect_err("duplicate");
        assert!(err.message.contains("duplicate"), "{}", err.message);
    }

    #[test]
    fn duplicate_component_ids_rejected() {
        let mut value = booking();
        value["screens"][0]["components"]
            .as_array_mut()
            .expect("list")
            .push(
                serde_json::json!({"id": "t1", "kind": "text", "text": "Other",
                               "requirements": [], "designs": []}),
            );
        let err = validate_mockup_value(&value, &["req-1".to_string()]).expect_err("duplicate");
        assert!(err.message.contains("duplicate"), "{}", err.message);
    }

    #[test]
    fn field_without_origin_rejected() {
        let mut value = booking();
        value["screens"][0]["components"][1]
            .as_object_mut()
            .expect("field")
            .remove("origin");
        let err = validate_mockup_value(&value, &["req-1".to_string()]).expect_err("no origin");
        assert!(err.message.contains("origin"), "{}", err.message);
    }

    #[test]
    fn unknown_origin_rejected() {
        let mut value = booking();
        value["screens"][0]["components"][1]["origin"] = serde_json::json!("magic");
        validate_mockup_value(&value, &["req-1".to_string()]).expect_err("invalid origin");
    }

    #[test]
    fn navigation_to_missing_screen_rejected() {
        let mut value = booking();
        value["screens"][0]["components"][3]["target"] = serde_json::json!("missing");
        let err =
            validate_mockup_value(&value, &["req-1".to_string()]).expect_err("no destination");
        assert!(err.message.contains("missing"), "{}", err.message);
    }

    #[test]
    fn refs_outside_allowed_set_rejected() {
        let err = validate_mockup_value(&booking(), &[]).expect_err("outside the set");
        assert!(err.message.contains("set"), "{}", err.message);
    }

    #[test]
    fn design_refs_need_artifact_and_element() {
        let mut value = booking();
        value["screens"][0]["requirements"] = serde_json::json!([]);
        value["screens"][0]["components"][0]["designs"] = serde_json::json!(["flujo-1/inicio"]);
        value["screens"][0]["components"][1]["requirements"] = serde_json::json!([]);
        let validated =
            validate_mockup_value(&value, &["flujo-1".to_string()]).expect("design ref");
        assert_eq!(
            validated.screens[0].components[0].designs,
            vec!["flujo-1/inicio".to_string()]
        );
        let mut bad = booking();
        bad["screens"][0]["components"][0]["designs"] = serde_json::json!(["no-slash"]);
        bad["screens"][0]["requirements"] = serde_json::json!([]);
        bad["screens"][0]["components"][1]["requirements"] = serde_json::json!([]);
        validate_mockup_value(&bad, &["flujo-1".to_string()]).expect_err("no shape");
    }

    #[test]
    fn component_ids_are_unique_across_screens() {
        let mut value = booking();
        value["screens"]
            .as_array_mut()
            .expect("list")
            .push(serde_json::json!({
                "id": "other", "title": "Other",
                "requirements": [], "designs": [],
                "components": [
                    {"id": "t1", "kind": "text", "text": "Repeated",
                     "requirements": [], "designs": []}
                ]
            }));
        let err = validate_mockup_value(&value, &["req-1".to_string()])
            .expect_err("repeated across screens");
        assert!(err.message.contains("duplicate"), "{}", err.message);
    }

    #[test]
    fn table_needs_columns_and_origin() {
        let value = serde_json::json!({
            "title": "Tables",
            "screens": [{
                "id": "p", "title": "P", "requirements": [], "designs": [],
                "components": [
                    {"id": "tb", "kind": "table", "label": "Lines",
                     "columns": ["a", "b"], "origin": "persisted",
                     "requirements": [], "designs": []}
                ]
            }]
        });
        let validated = validate_mockup_value(&value, &[]).expect("valid table");
        assert_eq!(validated.screens[0].components[0].columns.len(), 2);
        let mut bad = value.clone();
        bad["screens"][0]["components"][0]["columns"] = serde_json::json!([]);
        validate_mockup_value(&bad, &[]).expect_err("no columns");
    }

    #[test]
    fn excerpt_describes_screens_without_positions() {
        let validated = validate_mockup_value(&booking(), &["req-1".to_string()]).expect("valid");
        let excerpt = render_mockup_excerpt(&canonical_mockup_json(&validated), 2000);
        assert!(excerpt.contains("New booking"), "{excerpt}");
        assert!(excerpt.contains("Customer"), "{excerpt}");
        assert!(excerpt.contains("origin persisted"), "{excerpt}");
        assert!(excerpt.contains("origin temporary"), "{excerpt}");
        assert!(excerpt.contains("Confirm"), "{excerpt}");
    }

    #[test]
    fn excerpt_of_corrupt_content_is_honest() {
        let excerpt = render_mockup_excerpt("not json", 2000);
        assert!(excerpt.contains("unstructured"), "{excerpt}");
    }

    fn two_screens() -> serde_json::Value {
        let mut value = booking();
        value["screens"]
            .as_array_mut()
            .expect("list")
            .push(serde_json::json!({
                "id": "list", "title": "Booking list",
                "requirements": [], "designs": [],
                "components": [
                    {"id": "t2", "kind": "text", "text": "Bookings",
                     "requirements": [], "designs": []}
                ]
            }));
        value
    }

    #[test]
    fn screen_excerpt_renders_only_the_chosen_screen() {
        let validated =
            validate_mockup_value(&two_screens(), &["req-1".to_string()]).expect("valid");
        let spec = canonical_mockup_json(&validated);
        let excerpt = render_mockup_screen_excerpt(&spec, "list", 2000).expect("exists");
        assert!(excerpt.contains("Booking list"), "{excerpt}");
        assert!(excerpt.contains("Bookings"), "{excerpt}");
        assert!(!excerpt.contains("New booking"), "{excerpt}");
        assert!(!excerpt.contains("Customer"), "{excerpt}");
    }

    #[test]
    fn screen_excerpt_missing_screen_or_corrupt_is_none() {
        let validated = validate_mockup_value(&booking(), &["req-1".to_string()]).expect("valid");
        let spec = canonical_mockup_json(&validated);
        assert!(render_mockup_screen_excerpt(&spec, "other", 2000).is_none());
        assert!(render_mockup_screen_excerpt("not json", "new_booking", 2000).is_none());
        assert!(render_mockup_screen_excerpt("{\"title\": 1}", "new_booking", 2000).is_none());
    }

    #[test]
    fn screen_excerpt_truncates_with_ellipsis() {
        let validated = validate_mockup_value(&booking(), &["req-1".to_string()]).expect("valid");
        let spec = canonical_mockup_json(&validated);
        let excerpt = render_mockup_screen_excerpt(&spec, "new_booking", 20).expect("exists");
        assert!(excerpt.ends_with('…'), "{excerpt}");
        assert!(excerpt.chars().count() <= 21, "{excerpt}");
    }

    #[test]
    fn summary_counts_screens_and_components() {
        let validated = validate_mockup_value(&booking(), &["req-1".to_string()]).expect("valid");
        let summary = summarize_mockup(&validated);
        assert!(summary.contains("1 screen"), "{summary}");
        assert!(summary.contains("4 components"), "{summary}");
    }

    #[test]
    fn legacy_action_becomes_business_operation() {
        let validated = validate_mockup_value(&booking(), &["req-1".to_string()]).expect("valid");
        let button = &validated.screens[0].components[3];
        assert_eq!(button.action_kind, None);
        assert_eq!(button.operation.as_deref(), Some("confirm_booking"));
        // And the declarative shape is kept as is.
        let mut value = booking();
        value["screens"][0]["components"][3]["action"] = serde_json::json!("submit");
        let validated = validate_mockup_value(&value, &["req-1".to_string()]).expect("declarative");
        let button = &validated.screens[0].components[3];
        assert_eq!(button.action_kind, Some(MockupActionKind::Submit));
        assert_eq!(button.operation, None);
    }

    #[test]
    fn legacy_validation_folds_into_validations() {
        let mut value = booking();
        value["screens"][0]["components"][1]["validation"] = serde_json::json!("letters only");
        let validated = validate_mockup_value(&value, &["req-1".to_string()]).expect("valid");
        assert_eq!(
            validated.screens[0].components[1].validations,
            vec!["letters only".to_string()]
        );
        let canonical = canonical_mockup_json(&validated);
        assert!(
            canonical.contains("\"validations\":[\"letters only\"]"),
            "{canonical}"
        );
        assert!(!canonical.contains("validation\":"), "{canonical}");
    }

    #[test]
    fn container_groups_flat_children() {
        let value = serde_json::json!({
            "title": "Group", "screens": [{
                "id": "p", "title": "P", "requirements": [], "designs": [],
                "components": [
                    {"id": "a", "kind": "text", "text": "A",
                     "requirements": [], "designs": []},
                    {"id": "g", "kind": "container", "label": "Group",
                     "children": ["a"], "direction": "horizontal",
                     "requirements": [], "designs": []}
                ]
            }]
        });
        let validated = validate_mockup_value(&value, &[]).expect("container");
        let container = &validated.screens[0].components[1];
        assert_eq!(container.children, vec!["a".to_string()]);
        assert_eq!(container.direction, Some(MockupDirection::Horizontal));
    }

    #[test]
    fn container_rejects_missing_nested_and_shared_children() {
        let base = || {
            serde_json::json!({
                "title": "Group", "screens": [{
                    "id": "p", "title": "P", "requirements": [], "designs": [],
                    "components": [
                        {"id": "a", "kind": "text", "text": "A",
                         "requirements": [], "designs": []},
                        {"id": "g", "kind": "container", "label": "G",
                         "children": ["a"], "requirements": [], "designs": []}
                    ]
                }]
            })
        };
        let mut missing = base();
        missing["screens"][0]["components"][1]["children"] = serde_json::json!(["nobody"]);
        validate_mockup_value(&missing, &[]).expect_err("missing child");
        let mut nested = base();
        nested["screens"][0]["components"][0] = serde_json::json!(
            {"id": "h", "kind": "container", "label": "H",
             "children": [], "requirements": [], "designs": []});
        nested["screens"][0]["components"][1]["children"] = serde_json::json!(["h"]);
        validate_mockup_value(&nested, &[]).expect_err("no nesting");
        let mut shared = base();
        shared["screens"][0]["components"]
            .as_array_mut()
            .expect("list")
            .push(
                serde_json::json!({"id": "g2", "kind": "container", "label": "G2",
                           "children": ["a"], "requirements": [], "designs": []}),
            );
        validate_mockup_value(&shared, &[]).expect_err("single parent");
    }

    #[test]
    fn icon_needs_catalog_id_and_label() {
        let value = serde_json::json!({
            "title": "Icons", "screens": [{
                "id": "p", "title": "P", "requirements": [], "designs": [],
                "components": [
                    {"id": "i", "kind": "icon", "label": "Save",
                     "icon": "save", "icon_role": "button",
                     "action_kind": "submit", "tooltip": "Save the form",
                     "requirements": [], "designs": []}
                ]
            }]
        });
        let validated = validate_mockup_value(&value, &[]).expect("valid icon");
        let icon = &validated.screens[0].components[0];
        assert_eq!(icon.icon.as_deref(), Some("save"));
        assert_eq!(icon.icon_role, Some(MockupIconRole::Button));
        let mut bad = value.clone();
        bad["screens"][0]["components"][0]["icon"] = serde_json::json!("plane");
        let err = validate_mockup_value(&bad, &[]).expect_err("off catalog");
        assert!(err.message.contains("disallowed"), "{}", err.message);
    }

    #[test]
    fn data_ref_points_inside_allowed_set() {
        let mut value = booking();
        value["screens"][0]["components"][1]["data_ref"] =
            serde_json::json!("flujo-1/inicio.valor");
        let validated =
            validate_mockup_value(&value, &["req-1".to_string(), "flujo-1".to_string()])
                .expect("valid data_ref");
        assert_eq!(
            validated.screens[0].components[1].data_ref.as_deref(),
            Some("flujo-1/inicio.valor")
        );
        let mut bad = booking();
        bad["screens"][0]["components"][1]["data_ref"] = serde_json::json!("other/x");
        validate_mockup_value(&bad, &["req-1".to_string()]).expect_err("outside the set");
    }

    #[test]
    fn table_types_preview_and_row_actions() {
        let value = serde_json::json!({
            "title": "Tables", "screens": [{
                "id": "p", "title": "P", "requirements": [], "designs": [],
                "components": [
                    {"id": "tb", "kind": "table", "label": "Lines",
                     "columns": ["a", "b"], "column_types": ["text", "number"],
                     "preview_rows": [["x", "1"]], "row_actions": ["Edit"],
                     "origin": "persisted", "requirements": [], "designs": []}
                ]
            }]
        });
        let validated = validate_mockup_value(&value, &[]).expect("rich table");
        let table = &validated.screens[0].components[0];
        assert_eq!(table.column_types.len(), 2);
        assert_eq!(table.preview_rows.len(), 1);
        let mut bad = value.clone();
        bad["screens"][0]["components"][0]["column_types"] = serde_json::json!(["text"]);
        validate_mockup_value(&bad, &[]).expect_err("one type per column");
    }

    #[test]
    fn screen_states_are_named_and_unique() {
        let value = serde_json::json!({
            "title": "E", "screens": [{
                "id": "p", "title": "P", "requirements": [], "designs": [],
                "states": [{"id": "empty", "label": "Empty"}],
                "components": []
            }]
        });
        let validated = validate_mockup_value(&value, &[]).expect("state");
        assert_eq!(validated.screens[0].states.len(), 1);
        let mut bad = value.clone();
        bad["screens"][0]["states"] = serde_json::json!([
            {"id": "a", "label": "A"}, {"id": "a", "label": "B"}]);
        validate_mockup_value(&bad, &[]).expect_err("duplicate state");
    }

    #[test]
    fn screen_output_validates_each_screen_against_sent_set() {
        let text = serde_json::json!({
            "screens": [{
                "temp_id": "p1", "title": "Registro",
                "spec": {
                    "id": "registro", "title": "Registro",
                    "requirements": ["req-1"],
                    "components": [
                        {"id": "f_name", "kind": "field", "label": "Name",
                         "field_type": "text", "required": true,
                         "origin": "persisted", "requirements": ["req-1"]},
                        {"id": "b_ok", "kind": "button", "label": "Create",
                         "action_kind": "submit"}
                    ]
                },
                "explanation": "Minimal signup form."
            }],
            "questions": ["Is email required?"]
        })
        .to_string();
        let validated =
            parse_mockup_generation_output(&text, &["req-1".to_string()]).expect("valid");
        assert_eq!(validated.screens.len(), 1);
        assert_eq!(validated.screens[0].temp_id, "p1");
        assert_eq!(validated.questions.len(), 1);
        // The saved spec is the canonical form of a one-screen mockup.
        let spec: serde_json::Value =
            serde_json::from_str(&validated.screens[0].spec_json).expect("json");
        assert_eq!(spec["kind"], "mockup");
        assert_eq!(spec["screens"].as_array().expect("list").len(), 1);
    }

    #[test]
    fn screen_output_rejects_all_on_any_invalid_screen() {
        let base = serde_json::json!({
            "screens": [
                {"temp_id": "p1", "title": "Good",
                 "spec": {"id": "good", "title": "Good", "components": []},
                 "explanation": "Good."},
                {"temp_id": "p2", "title": "Bad",
                 "spec": {"id": "bad", "title": "Bad",
                          "components": [
                              {"id": "f", "kind": "field", "label": "F",
                               "field_type": "text", "requirements": ["req-9"]}
                          ]},
                 "explanation": "Bad."}
            ],
            "questions": []
        })
        .to_string();
        let err = parse_mockup_generation_output(&base, &["req-1".to_string()])
            .expect_err("all or nothing");
        assert!(err.message.contains("p2"), "{}", err.message);
        // Zero screens is incomplete output, not invalid.
        let empty = serde_json::json!({"screens": [], "questions": []}).to_string();
        let err =
            parse_mockup_generation_output(&empty, &["req-1".to_string()]).expect_err("incomplete");
        assert!(matches!(err.kind, MetaErrorKind::Incomplete));
        // Four screens exceed the maximum.
        let four: Vec<serde_json::Value> = (1..=4)
            .map(|n| {
                serde_json::json!({
                    "temp_id": format!("p{n}"), "title": "T",
                    "spec": {"id": format!("p{n}"), "title": "T", "components": []},
                    "explanation": "E"
                })
            })
            .collect();
        let many = serde_json::json!({ "screens": four, "questions": [] }).to_string();
        parse_mockup_generation_output(&many, &["req-1".to_string()]).expect_err("max 3");
    }

    #[test]
    fn generation_input_quotes_saved_versions_with_caps() {
        let context = vec![
            GenerationContextItem {
                artifact_id: "req-2".to_string(),
                version_id: "req-2-v3".to_string(),
                content: "second".to_string(),
            },
            GenerationContextItem {
                artifact_id: "req-1".to_string(),
                version_id: "req-1-v1".to_string(),
                content: "first".to_string(),
            },
        ];
        let input = build_mockup_generation_input(&context);
        assert!(input.contains("[req-1 @ req-1-v1]"), "{input}");
        assert!(input.contains("between 1 and 3 screens"), "{input}");
        assert!(input.find("req-1").expect("orden") < input.find("req-2").expect("orden"));
    }

    #[test]
    fn generation_schema_bounds_screens_and_components() {
        let schema = mockup_generation_json_schema();
        assert_eq!(schema["properties"]["screens"]["maxItems"], 3);
        assert_eq!(
            schema["properties"]["screens"]["items"]["properties"]["spec"]["properties"]
                ["components"]["maxItems"],
            40
        );
        let body = build_mockup_generation_body("m", "i");
        assert_eq!(body["max_output_tokens"], 8192);
        assert_eq!(body["text"]["format"]["name"], "mockup_screen_proposals");
    }

    #[test]
    fn navigate_target_must_exist_but_dialog_ref_need_not() {
        let value = serde_json::json!({
            "title": "N", "screens": [{
                "id": "p", "title": "P", "requirements": [], "designs": [],
                "components": [
                    {"id": "b", "kind": "button", "label": "Go",
                     "action_kind": "navigate", "target": "p",
                     "requirements": [], "designs": []},
                    {"id": "d", "kind": "button", "label": "Open",
                     "action_kind": "open_dialog", "target": "dlg_help",
                     "button_state": "disabled",
                     "requirements": [], "designs": []}
                ]
            }]
        });
        validate_mockup_value(&value, &[]).expect("valid destinations");
        let mut bad = value.clone();
        bad["screens"][0]["components"][0]["target"] = serde_json::json!("other");
        validate_mockup_value(&bad, &[]).expect_err("missing screen");
    }
}
