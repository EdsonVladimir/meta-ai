//! Lógica de diseños vinculados a requisitos: contexto aprobado, registro,
//! caducidad, validación de especificaciones, aceptación y aprobación.
//!
//! Espeja `proposals`: sin Tauri ni red, todo testeable con un generador
//! falso. Diferencias: el contexto son requisitos APROBADOS seleccionados,
//! cada generación trae UNA propuesta con especificación JSON canónica, y
//! aceptar puede crear el artefacto o versionar uno elegido.
//!
//! Reglas:
//! - El JSON es el contenido autoritativo; Mermaid se deriva y nunca se
//!   almacena como fuente ni se edita.
//! - Las dependencias del diseño apuntan a las versiones exactas utilizadas
//!   (el núcleo las valida: existencia, cruce, ciclos).
//! - Aceptar es atómico e idempotente; aprobar revalida contenido, vigencia
//!   y versión actual en Rust, nunca por un flag de React.

use ruth_core::application::Store;
use ruth_core::domain::{
    AgentId, ArtifactId, ArtifactType, Author, Content, CoreError, HumanId, ModuleId, ProjectId,
    VersionId,
};
use ruth_meta::design::{
    canonical_json, to_mermaid, validate_design_value, DesignKind, ValidatedDesign,
    DESIGN_MOCKUP_TEMPLATE_VERSION, DESIGN_TEMPLATE_VERSION, DESIGN_UPDATE_TEMPLATE_VERSION,
};
use ruth_meta::generation::GenerationContextItem;
use ruth_store::{
    DbActor, DesignLog, LayoutLog, ProposalState, StoredDesignGeneration, StoredDesignProposal,
};

use crate::dto::GetRequirementInput;
use crate::dto::{
    AcceptDesignInput, ApproveVersionInput, DesignContextInput, DesignContextPreview,
    DesignGenerationDto, DesignLayoutDto, DesignProposalDto, DiscardDesignInput,
    GetDesignLayoutInput, ListDesignsInput, RequirementDetail, SaveDesignLayoutInput,
    SaveDesignVersionInput, UsageDto, ValidateDesignInput, ValidatedDesignDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::logic::{approve_version, get_requirement};

/// Agente registrado como procedencia de lo aceptado desde un diseño.
fn agent_for(model: &str) -> Result<AgentId, ApiError> {
    AgentId::new(format!("ruth-gen/{model}")).map_err(ApiError::from)
}

/// Foto del contexto: versión actual exacta de cada requisito seleccionado.
/// Todos deben existir en el módulo y ser requisitos con versión actual.
/// Desde el diseño vivo NO se exige aprobación: se genera desde versiones
/// guardadas y la revisión queda como información (ver `approved` en la
/// vista previa). Selección vacía: error antes de consumir red.
pub fn snapshot_design_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
    selected: &[String],
) -> Result<Vec<GenerationContextItem>, ApiError> {
    if selected.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "Selecciona al menos un requisito como fuente.",
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
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::with_capacity(selected.len());
    for id in selected {
        if !seen.insert(id.clone()) {
            return Err(ApiError::coded(
                "duplicate_selection",
                format!("requisito repetido en la selección: {id}"),
            ));
        }
        let artifact = ruth_core::domain::ArtifactId::new(id.clone())?;
        let Some(known) = store.artifact(&artifact) else {
            return Err(CoreError::ArtifactNotFound { artifact }.into());
        };
        if known.project() != &project || known.module() != &module {
            return Err(ApiError::coded(
                "foreign_selection",
                format!("{id} no pertenece a este módulo"),
            ));
        }
        if known.artifact_type() != ArtifactType::Requirement {
            return Err(ApiError::coded(
                "not_a_requirement",
                format!("{id} no es un requisito"),
            ));
        }
        if store.is_effectively_archived(&artifact) {
            return Err(CoreError::ArchivedArtifact { artifact }.into());
        }
        let Some(current) = store.current_version(&artifact) else {
            return Err(ApiError::internal(format!("{id} no tiene versiones")));
        };
        // Sin barrera de aprobación (diseño vivo): la revisión de cada
        // fuente viaja como información en la vista previa, no como veto.
        items.push(GenerationContextItem {
            artifact_id: id.clone(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Vista previa del módulo para seleccionar fuentes: todos los requisitos
/// con su aprobación vigente.
pub fn design_context_preview(
    store: &Store,
    input: DesignContextInput,
) -> Result<Vec<DesignContextPreview>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut out = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        if artifact.artifact_type() != ArtifactType::Requirement {
            continue;
        }
        // Los archivados no se ofrecen como fuentes de diseños nuevos.
        if store.is_effectively_archived(artifact.id()) {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        let content = current.content().as_str();
        out.push(DesignContextPreview {
            artifact_id: artifact.id().as_str().to_string(),
            version_id: current.id().as_str().to_string(),
            chars: content.chars().count(),
            excerpt: excerpt(content),
            approved: store.is_approved(current.id()),
            title: artifact.title().map(str::to_string),
        });
    }
    out.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(out)
}

fn excerpt(content: &str) -> String {
    const MAX: usize = 120;
    let flat: String = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX {
        return flat;
    }
    let end = flat
        .char_indices()
        .nth(MAX)
        .map(|(i, _)| i)
        .unwrap_or(flat.len());
    format!("{}…", &flat[..end])
}

/// Objetivo fijado por una propuesta de actualización: el artefacto y su
/// versión en el momento del snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateTarget {
    pub artifact_id: String,
    pub version_id: String,
}

/// Entrada para registrar una generación de diseño recién validada. Sin
/// `target` es una creación; con él, una propuesta de actualización del
/// artefacto (misma tabla, mismo ciclo de aceptación).
pub struct RecordDesignInput {
    pub project_id: String,
    pub module_id: String,
    pub kind: DesignKind,
    pub model: String,
    pub context: Vec<GenerationContextItem>,
    pub validated: ValidatedDesign,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
    pub target: Option<UpdateTarget>,
}

/// Registra la generación en disco y memoria, con Mermaid derivable.
pub fn record_design_generation(
    store: &Store,
    ids: &mut IdGen,
    log: &mut DesignLog,
    db: &DbActor,
    input: RecordDesignInput,
) -> Result<DesignGenerationDto, ApiError> {
    if input.validated.kind != input.kind {
        return Err(ApiError::internal(
            "el diseño no coincide con el tipo pedido",
        ));
    }
    // El módulo pudo archivarse durante la red: revalidar antes de registrar.
    let module = ruth_core::domain::ModuleId::new(input.module_id.clone())?;
    if store.module(&module).is_some_and(|m| m.archived()) {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let mut ids_draft = ids.clone();
    let id = ids_draft.generation();
    // La plantilla queda registrada: actualización, creación desde mockups
    // (alguna fuente es un mockup) o creación desde requisitos. El contexto
    // ya fijó las versiones exactas; aquí solo se lee su tipo.
    let template_version = if input.target.is_some() {
        DESIGN_UPDATE_TEMPLATE_VERSION
    } else if context_has_mockup(store, &input.context) {
        DESIGN_MOCKUP_TEMPLATE_VERSION
    } else {
        DESIGN_TEMPLATE_VERSION
    };
    let (target_artifact_id, target_version_id) = match input.target {
        Some(target) => (Some(target.artifact_id), Some(target.version_id)),
        None => (None, None),
    };
    let generation = StoredDesignGeneration {
        id,
        project_id: input.project_id,
        module_id: input.module_id,
        kind: input.kind.as_str().to_string(),
        model: input.model,
        context_version_ids: input.context.iter().map(|c| c.version_id.clone()).collect(),
        template_version,
        target_artifact_id,
        target_version_id,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        total_tokens: input.total_tokens,
        created_at: input.created_at,
        questions: input.validated.questions.clone(),
        proposal: StoredDesignProposal {
            title: input.validated.title.clone(),
            spec_json: canonical_json(&input.validated),
            explanation: input.validated.explanation.clone(),
            state: ProposalState::Pending,
        },
    };
    let mut log_draft = log.clone();
    log_draft
        .record(generation.clone())
        .map_err(ApiError::storage)?;
    db.record_design(&generation).map_err(ApiError::storage)?;
    *log = log_draft;
    *ids = ids_draft;
    to_dto(store, &generation)
}

/// ¿Alguna versión del contexto pertenece a un mockup? Solo lectura de
/// tipos; las versiones ya se fijaron al capturar el contexto.
fn context_has_mockup(store: &Store, context: &[GenerationContextItem]) -> bool {
    context.iter().any(|item| {
        VersionId::new(item.version_id.clone())
            .ok()
            .and_then(|vid| store.version(&vid))
            .and_then(|version| store.artifact(version.artifact()))
            .is_some_and(|artifact| artifact.artifact_type() == ArtifactType::Mockup)
    })
}

/// Generaciones de diseño de un módulo con su caducidad calculada.
pub fn list_designs(
    store: &Store,
    log: &DesignLog,
    input: ListDesignsInput,
) -> Result<Vec<DesignGenerationDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    log.designs_of(module.as_str())
        .into_iter()
        .filter(|g| g.project_id == project.as_str())
        .map(|g| to_dto(store, g))
        .collect()
}

/// ¿Cambió alguna fuente desde la generación? Igual que en requisitos.
pub fn design_is_stale(store: &Store, generation: &StoredDesignGeneration) -> bool {
    if context_is_stale(store, generation) {
        return true;
    }
    update_target_moved(store, generation)
}

fn context_is_stale(store: &Store, generation: &StoredDesignGeneration) -> bool {
    for version_id in &generation.context_version_ids {
        let Ok(id) = VersionId::new(version_id.clone()) else {
            return true;
        };
        let Some(version) = store.version(&id) else {
            return true;
        };
        let current = store.current_version(version.artifact());
        if current.map(|c| c.id()) != Some(&id) {
            return true;
        }
    }
    false
}

/// ¿Cambió el objetivo desde el snapshot? Solo para actualizaciones: la
/// versión actual del artefacto ya no es la fijada al generar.
fn update_target_moved(store: &Store, generation: &StoredDesignGeneration) -> bool {
    let (Some(artifact), Some(version)) = (
        generation.target_artifact_id.as_deref(),
        generation.target_version_id.as_deref(),
    ) else {
        return false;
    };
    let Ok(artifact_id) = ruth_core::domain::ArtifactId::new(artifact.to_string()) else {
        return true;
    };
    match store.current_version(&artifact_id) {
        Some(current) => current.id().as_str() != version,
        None => true,
    }
}

/// Referencias citadas en una especificación: permite validar historial sin
/// conjunto enviado (todo lo demás se exige igual).
fn cited_refs(value: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    collect(value, &mut out);
    out.sort();
    out.dedup();
    out
}

fn collect(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                if key == "requirements" {
                    if let Some(items) = val.as_array() {
                        for item in items {
                            if let Some(text) = item.as_str() {
                                out.push(text.trim().to_string());
                            }
                        }
                    }
                } else {
                    collect(val, out);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect(item, out);
            }
        }
        _ => {}
    }
}

/// Valida una especificación bajo demanda (editor JSON, historial).
/// Con conjunto permitido exige referencias dentro de él; sin él, validación
/// estructural completa (lo que se revalida al aprobar).
pub fn validate_spec(
    kind_str: &str,
    spec: &serde_json::Value,
    allowed: Option<&[String]>,
) -> Result<ValidatedDesign, ApiError> {
    let kind = DesignKind::parse(kind_str).map_err(ApiError::from_meta)?;
    match allowed {
        Some(set) => validate_design_value(kind, spec, set).map_err(ApiError::from_meta),
        None => {
            let cited = cited_refs(spec);
            validate_design_value(kind, spec, &cited).map_err(ApiError::from_meta)
        }
    }
}

/// Comando de validación: con generación, dentro de su contexto.
pub fn validate_design(
    store: &Store,
    log: &DesignLog,
    input: ValidateDesignInput,
) -> Result<ValidatedDesignDto, ApiError> {
    let allowed: Option<Vec<String>> = match &input.generation_id {
        Some(id) => {
            let generation = log.design(id).ok_or_else(|| {
                ApiError::coded("design_not_found", format!("generación desconocida: {id}"))
            })?;
            let mut artifacts = Vec::new();
            for version_id in &generation.context_version_ids {
                let vid = VersionId::new(version_id.clone())?;
                let Some(version) = store.version(&vid) else {
                    return Err(ApiError::coded(
                        "design_stale",
                        "La generación está desactualizada.",
                    ));
                };
                artifacts.push(version.artifact().as_str().to_string());
            }
            Some(artifacts)
        }
        None => None,
    };
    let validated = validate_spec(&input.kind, &input.spec, allowed.as_deref())?;
    Ok(ValidatedDesignDto {
        canonical: canonical_json(&validated),
        mermaid: to_mermaid(&validated),
    })
}

fn to_dto(
    store: &Store,
    generation: &StoredDesignGeneration,
) -> Result<DesignGenerationDto, ApiError> {
    let spec: serde_json::Value = serde_json::from_str(&generation.proposal.spec_json)
        .map_err(|_| ApiError::internal(format!("la propuesta de {} no es JSON", generation.id)))?;
    // Lo guardado se validó al escribir; aquí se revalida estructuralmente
    // para derivar Mermaid. Si falla, los datos se corrompieron a mano.
    let validated = validate_spec(&generation.kind, &spec, None)?;
    let (state, artifact_id) = match &generation.proposal.state {
        ProposalState::Pending => ("pending".to_string(), None),
        ProposalState::Discarded => ("discarded".to_string(), None),
        ProposalState::Accepted { artifact_id, .. } => {
            ("accepted".to_string(), Some(artifact_id.clone()))
        }
    };
    Ok(DesignGenerationDto {
        id: generation.id.clone(),
        project_id: generation.project_id.clone(),
        module_id: generation.module_id.clone(),
        kind: generation.kind.clone(),
        model: generation.model.clone(),
        context_version_ids: generation.context_version_ids.clone(),
        template_version: generation.template_version,
        usage: UsageDto {
            input_tokens: generation.input_tokens,
            output_tokens: generation.output_tokens,
            total_tokens: generation.total_tokens,
        },
        created_at: generation.created_at.clone(),
        stale: design_is_stale(store, generation),
        questions: generation.questions.clone(),
        proposal: DesignProposalDto {
            title: generation.proposal.title.clone(),
            spec,
            mermaid: to_mermaid(&validated),
            explanation: generation.proposal.explanation.clone(),
            state,
            artifact_id,
        },
        target_artifact_id: generation.target_artifact_id.clone(),
        target_version_id: generation.target_version_id.clone(),
    })
}

/// La actualización acepta sobre el MISMO artefacto y la MISMA versión
/// del snapshot: si el diseño se movió, la propuesta caduca (no se acepta
/// en silencio sobre la nueva versión).
fn check_update_target(
    store: &Store,
    generation: &StoredDesignGeneration,
    input: &AcceptDesignInput,
) -> Result<(), ApiError> {
    let snapshot_artifact = generation.target_artifact_id.as_deref().unwrap_or_default();
    let snapshot_version = generation.target_version_id.as_deref().unwrap_or_default();
    if input.target_artifact_id.as_deref() != Some(snapshot_artifact) {
        return Err(ApiError::coded(
            "update_wrong_target",
            format!(
                "La propuesta actualiza {snapshot_artifact}: no puede aceptarse en otro artefacto."
            ),
        ));
    }
    if input.expected_version_id.as_deref() != Some(snapshot_version) {
        return Err(ApiError::coded(
            "update_stale",
            "La propuesta se generó sobre otra versión del diseño. Genera de nuevo.",
        ));
    }
    if update_target_moved(store, generation) {
        return Err(ApiError::coded(
            "update_stale",
            "El diseño cambió durante la revisión: la propuesta está desactualizada. \
             Genera de nuevo.",
        ));
    }
    Ok(())
}

/// Las fuentes del snapshot existen y siguen vigentes. La vigencia se
/// recalcula (una fuente de diseño pudo desactualizarse después). Sin
/// barrera de aprobación (diseño vivo): basta con fuentes guardadas y
/// vigentes; la revisión es informativa.
fn check_update_sources(store: &Store, sources: &[VersionId]) -> Result<(), ApiError> {
    for source in sources {
        let Some(version) = store.version(source) else {
            return Err(ApiError::coded(
                "update_stale",
                "Una fuente del snapshot ya no existe. Genera de nuevo.",
            ));
        };
        let validity = store.validity(source)?;
        if !validity.valid {
            return Err(ApiError::coded(
                "update_stale",
                format!(
                    "{} dejó de estar vigente: actualiza esa fuente y genera de nuevo.",
                    version.artifact().as_str()
                ),
            ));
        }
    }
    Ok(())
}

/// Acepta un diseño como borrador con procedencia IA, sin aprobarlo.
/// Crea el artefacto o versiona el elegido (con versión esperada), con las
/// versiones exactas del contexto como dependencias. Atómica e idempotente;
/// bloqueada si está desactualizada o no pendiente. Las actualizaciones
/// exigen además objetivo inmóvil y fuentes existentes y vigentes (sin
/// exigir aprobación: diseño vivo).
pub fn accept_design(
    store: &mut Store,
    ids: &mut IdGen,
    log: &mut DesignLog,
    db: &DbActor,
    input: AcceptDesignInput,
) -> Result<RequirementDetail, ApiError> {
    if let Some(artifact) = log.accepted_artifact(&input.generation_id) {
        return get_requirement(
            store,
            GetRequirementInput {
                artifact_id: artifact,
            },
        );
    }
    let generation = log
        .design(&input.generation_id)
        .ok_or_else(|| {
            ApiError::coded(
                "design_not_found",
                format!("generación desconocida: {}", input.generation_id),
            )
        })?
        .clone();
    match generation.proposal.state {
        ProposalState::Discarded => {
            return Err(ApiError::coded(
                "design_discarded",
                "La propuesta está descartada y no puede aceptarse.",
            ));
        }
        ProposalState::Accepted { .. } => {
            return Err(ApiError::coded(
                "design_accepted",
                "La propuesta ya se aceptó.",
            ));
        }
        ProposalState::Pending => {}
    }
    let is_update = generation.target_artifact_id.is_some();
    if is_update {
        check_update_target(store, &generation, &input)?;
    }
    if design_is_stale(store, &generation) {
        if is_update {
            return Err(ApiError::coded(
                "update_stale",
                "La propuesta está desactualizada: el diseño o una fuente cambió \
                 durante la generación o la revisión. Genera de nuevo.",
            ));
        }
        return Err(ApiError::coded(
            "design_stale",
            "La generación está desactualizada: cambió un requisito usado como \
             contexto. Genera de nuevo con el contexto actual.",
        ));
    }
    // Conjunto permitido: artefactos del contexto registrado.
    let mut allowed = Vec::with_capacity(generation.context_version_ids.len());
    let mut sources = Vec::with_capacity(generation.context_version_ids.len());
    for version_id in &generation.context_version_ids {
        let vid = VersionId::new(version_id.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded(
                "design_stale",
                "La generación está desactualizada.",
            ));
        };
        allowed.push(version.artifact().as_str().to_string());
        sources.push(vid);
    }
    if is_update {
        check_update_sources(store, &sources)?;
    }
    let validated = validate_spec(&generation.kind, &input.spec, Some(&allowed))?;
    let content = canonical_json(&validated);
    let project = ProjectId::new(generation.project_id.clone())?;
    let module = ModuleId::new(generation.module_id.clone())?;
    let agent = agent_for(&generation.model)?;
    let artifact_type = match validated.kind {
        DesignKind::Flow => ArtifactType::Flow,
        DesignKind::DataModel => ArtifactType::DataModel,
    };

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = match &input.target_artifact_id {
        None => {
            let id = match validated.kind {
                DesignKind::Flow => ids_draft.flow(),
                DesignKind::DataModel => ids_draft.data_model(),
            };
            store_draft.create_artifact(&project, &module, id.clone(), artifact_type)?;
            let version_id = IdGen::version(&id, 1);
            store_draft.accept_ai_draft(
                &project,
                &id,
                None,
                version_id,
                Content::new(content.clone())?,
                &agent,
                &sources,
            )?;
            id
        }
        Some(target) => {
            let id = ruth_core::domain::ArtifactId::new(target.clone())?;
            let Some(known) = store_draft.artifact(&id) else {
                return Err(CoreError::ArtifactNotFound { artifact: id }.into());
            };
            if known.artifact_type() != artifact_type {
                return Err(ApiError::coded(
                    "design_type_mismatch",
                    format!("{} no es del tipo {}", target, generation.kind),
                ));
            }
            let Some(expected_raw) = &input.expected_version_id else {
                return Err(ApiError::coded(
                    "missing_expected",
                    "Versionar exige la versión esperada.",
                ));
            };
            let expected = VersionId::new(expected_raw.clone())?;
            let number = store_draft.versions_of(&id).len() as u32 + 1;
            let version_id = IdGen::version(&id, number);
            store_draft.accept_ai_draft(
                &project,
                &id,
                Some(&expected),
                version_id,
                Content::new(content.clone())?,
                &agent,
                &sources,
            )?;
            id
        }
    };
    db.accept_design(
        &store_draft,
        ids_draft.checkpoint(),
        &generation.id,
        artifact_id.as_str(),
        &content,
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    log.mark_accepted(&generation.id, artifact_id.as_str(), &content)
        .map_err(ApiError::storage)?;
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact_id.as_str().to_string(),
        },
    )
}

/// Descarta una propuesta de diseño pendiente. Idempotente.
pub fn discard_design(
    log: &mut DesignLog,
    db: &DbActor,
    input: DiscardDesignInput,
) -> Result<(), ApiError> {
    if log.design(&input.generation_id).is_none() {
        return Err(ApiError::coded(
            "design_not_found",
            format!("generación desconocida: {}", input.generation_id),
        ));
    }
    db.discard_design(&input.generation_id)
        .map_err(ApiError::storage)?;
    log.mark_discarded(&input.generation_id)
        .map_err(ApiError::storage)?;
    Ok(())
}

/// Aprueba la versión actual de un diseño: exige artefacto de diseño,
/// contenido válido del tipo y delega vigencia, versión actual y humanidad
/// en el núcleo. Nada se decide por flags de React.
pub fn approve_design_version(
    store: &mut Store,
    input: ApproveVersionInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    let artifact = ruth_core::domain::ArtifactId::new(input.artifact_id.clone())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    let kind = match known.artifact_type() {
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Mockup => {
            return crate::mockup::approve_mockup_version(store, input, now);
        }
        ArtifactType::Requirement => {
            return Err(ApiError::coded(
                "not_a_design",
                "Este comando solo aprueba versiones de diseño.",
            ));
        }
    };
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal("el diseño no tiene versiones"));
    };
    let spec: serde_json::Value =
        serde_json::from_str(current.content().as_str()).map_err(|_| {
            ApiError::coded(
                "design_invalid",
                "El contenido no es JSON de diseño válido.",
            )
        })?;
    validate_spec(kind, &spec, None)
        .map_err(|_| ApiError::coded("design_invalid", "El contenido no es un diseño válido."))?;
    approve_version(store, input, now)
}

/// Entradas máximas de una disposición (muy por encima del subconjunto).
pub const MAX_LAYOUT_ENTRIES: usize = 128;
/// Longitud máxima de la clave de un elemento dispuesto.
pub const MAX_LAYOUT_KEY_CHARS: usize = 64;
/// Coordenada absoluta máxima admitida.
pub const MAX_LAYOUT_COORD: f64 = 100_000.0;

/// Tamaño máximo admitido en una disposición (ancho/alto de mockups).
pub const MAX_LAYOUT_SIZE: f64 = 100_000.0;

/// Higieniza una disposición candidata `{ elemento: { x, y, w?, h? } }` para
/// persistirla. Una no-objeto es un error del llamante; un objeto conserva
/// solo entradas bien formadas, en orden de clave (determinista). `w`/`h`
/// son opcionales (los usan los mockups redimensionables; los diagramas los
/// ignoran) y se conservan solo si son finitos y positivos. Vacía tras
/// higienizar equivale a "sin disposición" y no bloquea el guardado.
pub fn sanitize_layout(value: &serde_json::Value) -> Result<Option<String>, ApiError> {
    let Some(object) = value.as_object() else {
        return Err(ApiError::coded(
            "design_layout_invalid",
            "La disposición no es un objeto de posiciones.",
        ));
    };
    let mut entries: Vec<(&String, f64, f64, Option<f64>, Option<f64>)> = Vec::new();
    for (key, position) in object {
        if key.trim().is_empty() || key.chars().count() > MAX_LAYOUT_KEY_CHARS {
            continue;
        }
        let coords = position.as_object().and_then(|pos| {
            let x = pos.get("x")?.as_f64()?;
            let y = pos.get("y")?.as_f64()?;
            if !x.is_finite() || !y.is_finite() {
                return None;
            }
            let size = |name: &str| {
                pos.get(name)
                    .and_then(|v| v.as_f64())
                    .filter(|v| v.is_finite() && *v > 0.0 && *v <= MAX_LAYOUT_SIZE)
            };
            Some((x, y, size("w"), size("h")))
        });
        let Some((x, y, w, h)) = coords else { continue };
        if x.abs() > MAX_LAYOUT_COORD || y.abs() > MAX_LAYOUT_COORD {
            continue;
        }
        entries.push((key, x, y, w, h));
    }
    if entries.is_empty() {
        return Ok(None);
    }
    entries.sort_by(|a, b| a.0.cmp(b.0));
    entries.truncate(MAX_LAYOUT_ENTRIES);
    let mut map = serde_json::Map::with_capacity(entries.len());
    for (key, x, y, w, h) in entries {
        let mut pos = serde_json::Map::with_capacity(4);
        pos.insert("x".to_string(), serde_json::json!(x));
        pos.insert("y".to_string(), serde_json::json!(y));
        if let Some(w) = w {
            pos.insert("w".to_string(), serde_json::json!(w));
        }
        if let Some(h) = h {
            pos.insert("h".to_string(), serde_json::json!(h));
        }
        map.insert(key.clone(), serde_json::Value::Object(pos));
    }
    serde_json::to_string(&map)
        .map(Some)
        .map_err(|_| ApiError::internal("la disposición higienizada no serializa"))
}

/// Disposición guardada para una versión. Lectura tolerante: fila ausente o
/// ilegible equivale a "sin disposición" (el editor usa su trazado
/// automático); la presentación nunca rompe una consulta.
pub fn design_layout(layouts: &LayoutLog, input: GetDesignLayoutInput) -> DesignLayoutDto {
    let layout = layouts
        .get(&input.artifact_id, &input.version_id)
        .and_then(|raw| serde_json::from_str(raw).ok())
        .and_then(|value: serde_json::Value| value.is_object().then_some(value));
    DesignLayoutDto { layout }
}

/// Guarda solo la disposición de una versión existente, sin crear versión
/// nueva ni tocar el dominio. La versión debe existir; la disposición se
/// higieniza igual que en el guardado completo. No crea versiones vacías
/// cuando solo se reordena el lienzo.
pub fn save_design_layout_only(
    store: &Store,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: SaveDesignLayoutInput,
) -> Result<(), ApiError> {
    let version_id = VersionId::new(input.version_id.clone())?;
    let Some(version) = store.version(&version_id) else {
        return Err(ApiError::coded(
            "version_not_found",
            format!("La versión {} no existe.", input.version_id),
        ));
    };
    if version.artifact().as_str() != input.artifact_id {
        return Err(ApiError::coded(
            "version_not_found",
            format!(
                "La versión {} no es de {}.",
                input.version_id, input.artifact_id
            ),
        ));
    }
    let layout = sanitize_layout(&input.layout)?;
    db.upsert_design_layout(&input.artifact_id, &input.version_id, layout.as_deref())
        .map_err(ApiError::storage)?;
    if let Some(clean) = &layout {
        layouts.set(&input.artifact_id, &input.version_id, clean);
    }
    Ok(())
}

/// Guarda una revisión manual del editor visual como versión nueva del MISMO
/// artefacto, con procedencia humana y sin heredar aprobación. Revalida en
/// Rust: tipo de diseño, especificación (dentro del conjunto declarado),
/// fuentes declaradas existentes y vigentes, y versión esperada. Las fuentes
/// obsoletas bloquean con sus nombres: nadie las actualiza en silencio; la
/// persona adopta explícitamente las actuales y reintenta. La disposición
/// viaja en la misma transacción. Atómica: ante cualquier fallo, memoria,
/// disco e identificadores quedan intactos y el borrador se conserva en la
/// interfaz.
pub fn save_design_version(
    store: &mut Store,
    ids: &mut IdGen,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: SaveDesignVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id.clone())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    let kind = match known.artifact_type() {
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Mockup => {
            return Err(ApiError::coded(
                "not_a_design",
                "Este comando solo guarda flujos y modelos; los mockups se guardan con su propio comando.",
            ));
        }
        ArtifactType::Requirement => {
            return Err(ApiError::coded(
                "not_a_design",
                "Este comando solo guarda versiones de diseño.",
            ));
        }
    };
    if input.source_version_ids.is_empty() {
        return Err(ApiError::coded(
            "design_no_sources",
            "El diseño debe declarar sus fuentes exactas.",
        ));
    }
    // Fuentes declaradas: deben existir y ser las actuales de su artefacto.
    let mut sources = Vec::with_capacity(input.source_version_ids.len());
    let mut allowed = Vec::with_capacity(input.source_version_ids.len());
    let mut stale = Vec::new();
    for raw in &input.source_version_ids {
        let vid = VersionId::new(raw.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded(
                "design_source_missing",
                format!("La fuente {raw} no existe."),
            ));
        };
        let source_artifact = version.artifact().clone();
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
            "design_stale_sources",
            format!(
                "Fuentes obsoletas ({}): revisa sus versiones actuales y guarda de nuevo.",
                stale.join(", ")
            ),
        ));
    }
    let validated = validate_spec(kind, &input.spec, Some(&allowed))?;
    let content = canonical_json(&validated);
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
