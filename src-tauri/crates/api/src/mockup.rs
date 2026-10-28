//! Lógica de mockups versionados (diseño vivo, etapa B): creación manual,
//! guardado de revisiones, contexto para generar diseños y aprobación.
//!
//! Espeja `design` sin el circuito de propuestas de IA: los mockups los
//! dibuja la persona y sirven de contexto para proponer flujos o ER (el
//! registro y la aceptación usan la maquinaria existente de diseños).
//!
//! Reglas:
//! - El JSON canónico es el contenido autoritativo; la disposición visual
//!   vive aparte y mover componentes jamás crea versiones semánticas.
//! - Las referencias citadas (requisitos, elementos de diseño) deben
//!   pertenecer a las fuentes declaradas; las fuentes declaradas deben
//!   existir y estar vigentes. Sin fuentes solo vale sin referencias.
//! - Las referencias a elementos de diseño son enlaces semánticos
//!   informativos, no dependencias del núcleo: no crean ciclos.
//! - Guardar valida en Rust tipo, especificación, fuentes y versión
//!   esperada, en una sola transacción con la disposición.

use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, Content, CoreError, HumanId, ModuleId, ProjectId, VersionId,
};
use ruth_meta::generation::GenerationContextItem;
use ruth_meta::mockup::{canonical_mockup_json, render_mockup_excerpt, validate_mockup_value};
use ruth_store::{DbActor, LayoutLog};

use crate::design::sanitize_layout;
use crate::dto::{
    ApproveVersionInput, CreateMockupInput, DesignContextInput, DesignContextPreview,
    GetRequirementInput, MockupContextPreview, RequirementDetail, SaveMockupVersionInput,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::logic::{approve_version, get_requirement};

/// Foto del contexto para generar un diseño: versiones actuales exactas de
/// los requisitos y mockups seleccionados. Del mismo módulo, no archivados,
/// con versión actual; al menos un elemento en total. Un mockup puede ir
/// sin requisitos (la plantilla pide entonces señalar lo que falta).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockupSnapshot {
    pub requirements: Vec<GenerationContextItem>,
    pub mockups: Vec<GenerationContextItem>,
}

pub fn snapshot_mockup_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
    requirement_ids: &[String],
    mockup_ids: &[String],
) -> Result<MockupSnapshot, ApiError> {
    if requirement_ids.is_empty() && mockup_ids.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "Selecciona al menos un requisito o un mockup como fuente.",
        ));
    }
    let project = ProjectId::new(project_id.to_string())?;
    let module = ModuleId::new(module_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    let Some(module_ref) = store.module(&module) else {
        return Err(CoreError::ModuleNotFound { module }.into());
    };
    if module_ref.archived() {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let requirements = snapshot_list(
        store,
        &project,
        &module,
        requirement_ids,
        ArtifactType::Requirement,
        "requisito",
    )?;
    let mockups = snapshot_list(
        store,
        &project,
        &module,
        mockup_ids,
        ArtifactType::Mockup,
        "mockup",
    )?;
    Ok(MockupSnapshot {
        requirements,
        mockups,
    })
}

fn snapshot_list(
    store: &Store,
    project: &ProjectId,
    module: &ModuleId,
    selected: &[String],
    expected: ArtifactType,
    what: &str,
) -> Result<Vec<GenerationContextItem>, ApiError> {
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::with_capacity(selected.len());
    for id in selected {
        if !seen.insert(id.clone()) {
            return Err(ApiError::coded(
                "duplicate_selection",
                format!("{what} repetido en la selección: {id}"),
            ));
        }
        let artifact = ArtifactId::new(id.clone())?;
        let Some(known) = store.artifact(&artifact) else {
            return Err(CoreError::ArtifactNotFound { artifact }.into());
        };
        if known.project() != project || known.module() != module {
            return Err(ApiError::coded(
                "foreign_selection",
                format!("{id} no pertenece a este módulo"),
            ));
        }
        if known.artifact_type() != expected {
            return Err(ApiError::coded(
                "not_a_requirement",
                format!("{id} no es un {what}"),
            ));
        }
        if store.is_effectively_archived(&artifact) {
            return Err(CoreError::ArchivedArtifact { artifact }.into());
        }
        let Some(current) = store.current_version(&artifact) else {
            return Err(ApiError::internal(format!("{id} no tiene versiones")));
        };
        items.push(GenerationContextItem {
            artifact_id: id.clone(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Vista previa del módulo para generar desde mockups y declarar fuentes:
/// requisitos, diseños y mockups no archivados con su versión actual,
/// extracto y revisión.
pub fn mockup_context_preview(
    store: &Store,
    input: DesignContextInput,
) -> Result<MockupContextPreview, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut requirements = Vec::new();
    let mut designs = Vec::new();
    let mut mockups = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        let kind = artifact.artifact_type();
        if store.is_effectively_archived(artifact.id()) {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        let content = current.content().as_str();
        let excerpt = if kind == ArtifactType::Mockup {
            one_line(&render_mockup_excerpt(content, 240), 120)
        } else {
            one_line(content, 120)
        };
        let item = DesignContextPreview {
            artifact_id: artifact.id().as_str().to_string(),
            version_id: current.id().as_str().to_string(),
            chars: content.chars().count(),
            excerpt,
            approved: store.is_approved(current.id()),
            title: artifact.title().map(str::to_string),
        };
        match kind {
            ArtifactType::Requirement => requirements.push(item),
            ArtifactType::Mockup => mockups.push(item),
            ArtifactType::Flow | ArtifactType::DataModel => designs.push(item),
        };
    }
    requirements.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    designs.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    mockups.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(MockupContextPreview {
        requirements,
        designs,
        mockups,
    })
}

fn one_line(text: &str, max_chars: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max_chars {
        return flat;
    }
    let end = flat
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(flat.len());
    format!("{}…", flat[..end].trim_end())
}

/// Valida una especificación de mockup. Con conjunto declarado, las
/// referencias deben pertenecer a él; sin él, se revalida contra las
/// citadas (estructural: para lecturas y exportación).
pub fn validate_mockup_spec(
    spec: &serde_json::Value,
    allowed: Option<&[String]>,
) -> Result<ruth_meta::mockup::ValidatedMockup, ApiError> {
    match allowed {
        Some(set) => validate_mockup_value(spec, set).map_err(ApiError::from_meta),
        None => {
            let cited = mockup_cited_refs(spec);
            validate_mockup_value(spec, &cited).map_err(ApiError::from_meta)
        }
    }
}

/// Frescura de las fuentes de la versión actual de un mockup: versión
/// utilizada frente a actual, cambio y revisión. El editor la usa para
/// ofrecer adoptar explícitamente las actuales antes de guardar (el
/// guardado revalida en Rust y bloquea las obsoletas por nombre).
pub fn mockup_sources(
    store: &Store,
    project_id: &str,
    artifact_id: &str,
) -> Result<Vec<crate::dto::UpdateSourceDto>, ApiError> {
    use crate::dto::UpdateSourceDto;
    let project = ProjectId::new(project_id.to_string())?;
    let artifact = ArtifactId::new(artifact_id.to_string())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    if known.project() != &project {
        return Err(CoreError::ArtifactNotInProject { artifact, project }.into());
    }
    if known.artifact_type() != ArtifactType::Mockup {
        return Err(ApiError::coded(
            "not_a_mockup",
            "Este comando solo informa fuentes de mockups.",
        ));
    }
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal("el mockup no tiene versiones"));
    };
    let mut sources = Vec::with_capacity(current.sources().len());
    for used in current.sources() {
        // Las fuentes declaradas por la API siempre existen; si falta
        // alguna (base manipulada), se omite en vez de inventar.
        let Some(used_version) = store.version(used) else {
            continue;
        };
        let source_artifact = used_version.artifact().clone();
        let Some(source_current) = store.current_version(&source_artifact) else {
            continue;
        };
        let Some(source_ref) = store.artifact(&source_artifact) else {
            continue;
        };
        sources.push(UpdateSourceDto {
            artifact_id: source_artifact.as_str().to_string(),
            kind: crate::baseline::kind_str(source_ref.artifact_type()).to_string(),
            used_version_id: used.as_str().to_string(),
            used_content: used_version.content().as_str().to_string(),
            current_version_id: source_current.id().as_str().to_string(),
            current_content: source_current.content().as_str().to_string(),
            changed: used != source_current.id(),
            current_approved: store.is_approved(source_current.id()),
            current_valid: store.validity(source_current.id())?.valid,
        });
    }
    sources.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(sources)
}

/// Comando de validación estructural: contra sus propias citas, sin red.
/// Devuelve el canónico y el resumen para mostrar y revisar.
pub fn validate_mockup_stored(
    input: crate::dto::ValidateMockupInput,
) -> Result<crate::dto::ValidatedMockupDto, ApiError> {
    let validated = validate_mockup_spec(&input.spec, None)?;
    Ok(crate::dto::ValidatedMockupDto {
        canonical: canonical_mockup_json(&validated),
        title: validated.title.clone(),
        screens: validated.screens.len(),
        components: validated.screens.iter().map(|s| s.components.len()).sum(),
    })
}

/// Artefactos citados en una especificación (requisitos y parte artefacto
/// de las referencias a diseños), ordenados y sin duplicados.
pub fn mockup_cited_refs(spec: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    let empty = Vec::new();
    let screens = spec
        .get("screens")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    for screen in screens {
        collect_mockup_refs(screen, &mut out);
        if let Some(components) = screen.get("components").and_then(|v| v.as_array()) {
            for component in components {
                collect_mockup_refs(component, &mut out);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn collect_mockup_refs(node: &serde_json::Value, out: &mut Vec<String>) {
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

/// Fuentes declaradas: deben existir y ser actuales; las obsoletas se
/// devuelven con nombre para bloquear con explicación. Vacías solo valen
/// si la especificación no cita referencias.
fn resolve_mockup_sources(
    store: &Store,
    source_version_ids: &[String],
    cited: &[String],
) -> Result<(Vec<VersionId>, Vec<String>), ApiError> {
    if source_version_ids.is_empty() {
        if cited.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }
        return Err(ApiError::coded(
            "mockup_no_sources",
            format!(
                "Sin fuentes declaradas no puede citarse ({}): declara sus versiones exactas.",
                cited.join(", ")
            ),
        ));
    }
    let mut sources = Vec::with_capacity(source_version_ids.len());
    let mut allowed = Vec::with_capacity(source_version_ids.len());
    let mut seen = std::collections::HashSet::new();
    let mut stale = Vec::new();
    for raw in source_version_ids {
        let vid = VersionId::new(raw.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded(
                "mockup_source_missing",
                format!("La fuente {raw} no existe."),
            ));
        };
        let source_artifact = version.artifact().clone();
        // Una sola versión por artefacto: dos fijaciones del mismo harían
        // la vigencia imposible (una siempre sería obsoleta).
        if !seen.insert(source_artifact.as_str().to_string()) {
            return Err(ApiError::coded(
                "mockup_duplicate_source",
                format!(
                    "{} aparece dos veces entre las fuentes: declara una sola versión.",
                    source_artifact.as_str()
                ),
            ));
        }
        let is_current = store
            .current_version(&source_artifact)
            .map(|current| current.id() == &vid)
            .unwrap_or(false);
        if !is_current {
            stale.push(source_artifact.as_str().to_string());
        }
        allowed.push(source_artifact.as_str().to_string());
        sources.push(vid);
    }
    if !stale.is_empty() {
        stale.sort();
        stale.dedup();
        return Err(ApiError::coded(
            "mockup_stale_sources",
            format!(
                "Fuentes obsoletas ({}): revisa sus versiones actuales y guarda de nuevo.",
                stale.join(", ")
            ),
        ));
    }
    Ok((sources, allowed))
}

/// Crea un mockup dibujado por la persona: artefacto nuevo con su primera
/// versión, contenido validado y disposición inicial en una sola
/// transacción. Atómica: ante cualquier fallo, memoria, disco e
/// identificadores quedan intactos.
pub fn create_mockup(
    store: &mut Store,
    ids: &mut IdGen,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: CreateMockupInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    let Some(module_ref) = store.module(&module) else {
        return Err(CoreError::ModuleNotFound { module }.into());
    };
    if module_ref.archived() {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let cited = mockup_cited_refs(&input.spec);
    let (sources, allowed) = resolve_mockup_sources(store, &input.source_version_ids, &cited)?;
    let validated = validate_mockup_spec(&input.spec, Some(&allowed))?;
    let content = canonical_mockup_json(&validated);
    let author = Author::Human(HumanId::new(input.author)?);
    let layout = match &input.layout {
        None => None,
        Some(value) => sanitize_layout(value)?,
    };

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = ids_draft.mockup();
    store_draft.create_artifact(&project, &module, artifact_id.clone(), ArtifactType::Mockup)?;
    let version_id = IdGen::version(&artifact_id, 1);
    store_draft.create_version(
        &project,
        &artifact_id,
        None,
        version_id.clone(),
        Content::new(content)?,
        &author,
        &sources,
    )?;
    db.save_design_layout(
        &store_draft,
        ids_draft.checkpoint(),
        artifact_id.as_str(),
        version_id.as_str(),
        layout.as_deref(),
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    if let Some(clean) = &layout {
        layouts.set(artifact_id.as_str(), version_id.as_str(), clean);
    }
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact_id.as_str().to_string(),
        },
    )
}

/// Guarda una revisión manual como versión nueva del MISMO mockup, con
/// procedencia humana y sin heredar aprobación. Revalida tipo,
/// especificación, fuentes vigentes y versión esperada; la disposición
/// viaja en la misma transacción. Atómica: ante cualquier fallo, memoria,
/// disco e identificadores quedan intactos.
pub fn save_mockup_version(
    store: &mut Store,
    ids: &mut IdGen,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: SaveMockupVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id.clone())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    if known.artifact_type() != ArtifactType::Mockup {
        return Err(ApiError::coded(
            "not_a_mockup",
            "Este comando solo guarda versiones de mockups.",
        ));
    }
    if store.is_effectively_archived(&artifact) {
        return Err(CoreError::ArchivedArtifact { artifact }.into());
    }
    let cited = mockup_cited_refs(&input.spec);
    let (sources, allowed) = resolve_mockup_sources(store, &input.source_version_ids, &cited)?;
    let validated = validate_mockup_spec(&input.spec, Some(&allowed))?;
    let content = canonical_mockup_json(&validated);
    let expected = VersionId::new(input.expected_version_id)?;
    let author = Author::Human(HumanId::new(input.author)?);
    let layout = match &input.layout {
        None => None,
        Some(value) => sanitize_layout(value)?,
    };

    let mut store_draft = store.clone();
    let ids_draft = ids.clone();
    let number = store_draft.versions_of(&artifact).len() as u32 + 1;
    let version_id = IdGen::version(&artifact, number);
    store_draft.create_version(
        &project,
        &artifact,
        Some(&expected),
        version_id.clone(),
        Content::new(content)?,
        &author,
        &sources,
    )?;
    db.save_design_layout(
        &store_draft,
        ids_draft.checkpoint(),
        artifact.as_str(),
        version_id.as_str(),
        layout.as_deref(),
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    if let Some(clean) = &layout {
        layouts.set(artifact.as_str(), version_id.as_str(), clean);
    }
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: input.artifact_id,
        },
    )
}

/// Aprueba la versión actual de un mockup con una acción humana explícita:
/// revalida que el contenido siga siendo un mockup válido y delega en la
/// aprobación genérica (vigencia y versión actual). La persistencia la
/// envuelve el comando (`transact`).
pub fn approve_mockup_version(
    store: &mut Store,
    input: ApproveVersionInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    let artifact = ArtifactId::new(input.artifact_id.clone())?;
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal("el mockup no tiene versiones"));
    };
    let spec: serde_json::Value =
        serde_json::from_str(current.content().as_str()).map_err(|_| {
            ApiError::coded(
                "mockup_invalid",
                "El contenido no es JSON de mockup válido.",
            )
        })?;
    validate_mockup_spec(&spec, None)
        .map_err(|_| ApiError::coded("mockup_invalid", "El contenido no es un mockup válido."))?;
    approve_version(store, input, now)
}
