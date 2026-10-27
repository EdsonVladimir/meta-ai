//! Lógica de generaciones asistidas: contexto, registro, caducidad,
//! aceptación y descarte.
//!
//! Sin Tauri ni red: recibe el `Store`, el `ProposalLog`, el `IdGen` y el
//! resultado ya validado de Meta como entradas, así que todo es testeable
//! con un generador falso (los tests construyen la salida a mano). El
//! comando Tauri solo orquesta: foto del contexto, red fuera de bloqueos y
//! registro posterior.
//!
//! Reglas:
//! - El contexto consultado NO crea dependencias de negocio: aceptar una
//!   propuesta crea un requisito sin fuentes. Convertir el contexto en
//!   dependencias inventaría relaciones y podría introducir ciclos.
//! - La caducidad se calcula, no se almacena: una generación está
//!   desactualizada si alguna versión de su contexto ya no es la actual.
//!   Aceptar una propuesta desactualizada está bloqueado.
//! - Aceptar es atómico e idempotente: dominio y estado en una transacción;
//!   reintentar devuelve el detalle existente sin duplicar nada.

use ruth_core::application::Store;
use ruth_core::domain::{
    AgentId, ArtifactType, Content, CoreError, ModuleId, ProjectId, VersionId,
};
use ruth_meta::generation::{
    GenerationContextItem, ValidatedGeneration, MAX_ACCEPTANCE_ITEMS, MAX_ASSUMPTION_ITEMS,
    MAX_DESCRIPTION_CHARS, MAX_ITEM_CHARS, MAX_PROPOSAL_CHARS, MAX_TITLE_CHARS, TEMPLATE_VERSION,
};
use ruth_store::{DbActor, ProposalLog, ProposalState, StoredGeneration, StoredProposal};

use crate::dto::{
    AcceptProposalInput, DiscardProposalInput, GenerationContextInput, GenerationContextPreview,
    GenerationDto, GetRequirementInput, ListGenerationsInput, ProposalDto, RequirementDetail,
    UsageDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::logic::get_requirement;

/// Agente registrado como procedencia de lo aceptado desde una generación.
fn agent_for(model: &str) -> Result<AgentId, ApiError> {
    AgentId::new(format!("ruth-gen/{model}")).map_err(ApiError::from)
}

/// Valida la descripción del módulo antes de generar.
pub fn validate_description(description: &str) -> Result<String, ApiError> {
    let trimmed = description.trim();
    if trimmed.is_empty() {
        return Err(ApiError::coded(
            "empty_description",
            "Describe el módulo antes de proponer requisitos.",
        ));
    }
    if trimmed.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(ApiError::coded(
            "description_too_long",
            format!("la descripción supera {MAX_DESCRIPTION_CHARS} caracteres"),
        ));
    }
    Ok(trimmed.to_string())
}

/// Foto del contexto: versión actual exacta de cada requisito del módulo,
/// ordenada por artefacto. Se toma antes de la red y se registra con la
/// generación para detectar caducidad después.
pub fn snapshot_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
) -> Result<Vec<GenerationContextItem>, ApiError> {
    let project = ProjectId::new(project_id.to_string())?;
    let module = ModuleId::new(module_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut items = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        if artifact.artifact_type() != ArtifactType::Requirement {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        items.push(GenerationContextItem {
            artifact_id: artifact.id().as_str().to_string(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Vista previa del contexto para la interfaz: qué se enviará, sin enviarlo.
pub fn context_preview(
    store: &Store,
    input: GenerationContextInput,
) -> Result<Vec<GenerationContextPreview>, ApiError> {
    Ok(
        snapshot_context(store, &input.project_id, &input.module_id)?
            .into_iter()
            .map(|item| {
                let chars = item.content.chars().count();
                GenerationContextPreview {
                    artifact_id: item.artifact_id,
                    version_id: item.version_id,
                    chars,
                    excerpt: excerpt(&item.content),
                }
            })
            .collect(),
    )
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

/// Entrada para registrar una generación recién validada.
pub struct RecordInput {
    pub project_id: String,
    pub module_id: String,
    pub model: String,
    pub description: String,
    pub context: Vec<GenerationContextItem>,
    pub validated: ValidatedGeneration,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
}

/// Registra la generación en disco y memoria. El identificador definitivo
/// (`gen-N`) lo crea la app; los temporales del modelo no salen de su ámbito.
pub fn record_generation(
    store: &Store,
    ids: &mut IdGen,
    log: &mut ProposalLog,
    db: &DbActor,
    input: RecordInput,
) -> Result<GenerationDto, ApiError> {
    let mut ids_draft = ids.clone();
    let id = ids_draft.generation();
    let generation = StoredGeneration {
        id,
        project_id: input.project_id,
        module_id: input.module_id,
        model: input.model,
        description: input.description,
        context_version_ids: input.context.iter().map(|c| c.version_id.clone()).collect(),
        template_version: TEMPLATE_VERSION,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        total_tokens: input.total_tokens,
        created_at: input.created_at,
        questions: input.validated.questions,
        proposals: input
            .validated
            .proposals
            .into_iter()
            .map(|p| StoredProposal {
                temp_id: p.temp_id,
                title: p.title,
                description: p.description,
                acceptance: p.acceptance,
                assumptions: p.assumptions,
                state: ProposalState::Pending,
            })
            .collect(),
    };
    // Validar en una copia antes de tocar disco o memoria publicados.
    let mut log_draft = log.clone();
    log_draft
        .record(generation.clone())
        .map_err(ApiError::storage)?;
    db.record_generation(&generation)
        .map_err(ApiError::storage)?;
    *log = log_draft;
    *ids = ids_draft;
    Ok(to_dto(store, &generation))
}

/// Generaciones de un módulo con su caducidad calculada.
pub fn list_generations(
    store: &Store,
    log: &ProposalLog,
    input: ListGenerationsInput,
) -> Result<Vec<GenerationDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    Ok(log
        .generations_of(module.as_str())
        .into_iter()
        .filter(|g| g.project_id == project.as_str())
        .map(|g| to_dto(store, g))
        .collect())
}

/// ¿Cambió alguna fuente desde la generación? Conservadora: versión
/// desconocida o ausente también cuenta como desactualizada.
pub fn generation_is_stale(store: &Store, generation: &StoredGeneration) -> bool {
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

fn to_dto(store: &Store, generation: &StoredGeneration) -> GenerationDto {
    GenerationDto {
        id: generation.id.clone(),
        project_id: generation.project_id.clone(),
        module_id: generation.module_id.clone(),
        model: generation.model.clone(),
        description: generation.description.clone(),
        context_version_ids: generation.context_version_ids.clone(),
        template_version: generation.template_version,
        usage: UsageDto {
            input_tokens: generation.input_tokens,
            output_tokens: generation.output_tokens,
            total_tokens: generation.total_tokens,
        },
        created_at: generation.created_at.clone(),
        stale: generation_is_stale(store, generation),
        questions: generation.questions.clone(),
        proposals: generation
            .proposals
            .iter()
            .map(|p| {
                let (state, artifact_id) = match &p.state {
                    ProposalState::Pending => ("pending".to_string(), None),
                    ProposalState::Discarded => ("discarded".to_string(), None),
                    ProposalState::Accepted { artifact_id, .. } => {
                        ("accepted".to_string(), Some(artifact_id.clone()))
                    }
                };
                ProposalDto {
                    temp_id: p.temp_id.clone(),
                    title: p.title.clone(),
                    description: p.description.clone(),
                    acceptance: p.acceptance.clone(),
                    assumptions: p.assumptions.clone(),
                    state,
                    artifact_id,
                }
            })
            .collect(),
    }
}

/// Campos de una propuesta ya validados, listos para componer.
pub struct AcceptedFields {
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
}

/// Valida los campos editados por la persona con los mismos límites de la
/// salida del modelo: la interfaz no es de fiar para estos topes.
fn validate_accepted(input: &AcceptProposalInput) -> Result<AcceptedFields, ApiError> {
    let bad =
        |what: &str| ApiError::coded("invalid_proposal", format!("propuesta inválida: {what}"));
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(bad("título vacío o excesivo"));
    }
    let description = input.description.trim();
    if description.is_empty() || description.chars().count() > MAX_PROPOSAL_CHARS {
        return Err(bad("descripción vacía o excesiva"));
    }
    let acceptance = validate_items(&input.acceptance, "criterios", 1, MAX_ACCEPTANCE_ITEMS)?;
    let assumptions = validate_items(&input.assumptions, "supuestos", 0, MAX_ASSUMPTION_ITEMS)?;
    Ok(AcceptedFields {
        title: title.to_string(),
        description: description.to_string(),
        acceptance,
        assumptions,
    })
}

fn validate_items(
    items: &[String],
    what: &str,
    min: usize,
    max: usize,
) -> Result<Vec<String>, ApiError> {
    if items.len() < min || items.len() > max {
        return Err(ApiError::coded(
            "invalid_proposal",
            format!("propuesta inválida: {what} debe tener entre {min} y {max} elementos"),
        ));
    }
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_ITEM_CHARS {
            return Err(ApiError::coded(
                "invalid_proposal",
                format!("propuesta inválida: {what} con elemento vacío o excesivo"),
            ));
        }
        out.push(trimmed.to_string());
    }
    Ok(out)
}

/// Composición determinista del contenido del requisito desde los campos.
/// Una sola forma canónica: título, descripción, criterios y supuestos.
pub fn compose_content(fields: &AcceptedFields) -> String {
    let mut content = format!("{}\n\n{}", fields.title, fields.description);
    content.push_str("\n\nCriterios de aceptación:");
    for criterion in &fields.acceptance {
        content.push_str(&format!("\n- {criterion}"));
    }
    if !fields.assumptions.is_empty() {
        content.push_str("\n\nSupuestos:");
        for assumption in &fields.assumptions {
            content.push_str(&format!("\n- {assumption}"));
        }
    }
    content
}

/// Acepta una propuesta como borrador con procedencia IA, sin aprobarla.
/// Atómica (dominio + estado en una transacción) e idempotente: reintentar
/// devuelve el detalle existente sin crear duplicados. Bloqueada si la
/// generación está desactualizada o la propuesta no está pendiente.
pub fn accept_proposal(
    store: &mut Store,
    ids: &mut IdGen,
    log: &mut ProposalLog,
    db: &DbActor,
    input: AcceptProposalInput,
) -> Result<RequirementDetail, ApiError> {
    // Idempotencia primero: si ya se aceptó, devolver lo existente.
    if let Some(artifact) = log.accepted_artifact(&input.generation_id, &input.temp_id) {
        return get_requirement(
            store,
            GetRequirementInput {
                artifact_id: artifact,
            },
        );
    }
    let generation = log
        .generation(&input.generation_id)
        .ok_or_else(|| {
            ApiError::coded(
                "generation_not_found",
                format!("generación desconocida: {}", input.generation_id),
            )
        })?
        .clone();
    let proposal = generation
        .proposals
        .iter()
        .find(|p| p.temp_id == input.temp_id)
        .ok_or_else(|| {
            ApiError::coded(
                "proposal_not_found",
                format!("propuesta desconocida: {}", input.temp_id),
            )
        })?;
    match proposal.state {
        ProposalState::Discarded => {
            return Err(ApiError::coded(
                "proposal_discarded",
                "La propuesta está descartada y no puede aceptarse.",
            ));
        }
        ProposalState::Accepted { .. } => {
            // Defensa: el registro y la memoria discrepan; no duplicar.
            return Err(ApiError::coded(
                "proposal_accepted",
                "La propuesta ya se aceptó.",
            ));
        }
        ProposalState::Pending => {}
    }
    if generation_is_stale(store, &generation) {
        return Err(ApiError::coded(
            "generation_stale",
            "La generación está desactualizada: cambió un requisito usado como \
             contexto. Genera de nuevo con el contexto actual.",
        ));
    }
    let fields = validate_accepted(&input)?;
    let content = compose_content(&fields);
    let project = ProjectId::new(generation.project_id.clone())?;
    let module = ModuleId::new(generation.module_id.clone())?;
    let agent = agent_for(&generation.model)?;

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = ids_draft.requirement();
    store_draft.create_artifact(
        &project,
        &module,
        artifact_id.clone(),
        ArtifactType::Requirement,
    )?;
    let version_id = IdGen::version(&artifact_id, 1);
    // Sin fuentes: el contexto consultado no es dependencia de negocio.
    store_draft.accept_ai_draft(
        &project,
        &artifact_id,
        None,
        version_id,
        Content::new(content.clone())?,
        &agent,
        &[],
    )?;
    db.accept_proposal(
        &store_draft,
        ids_draft.checkpoint(),
        &generation.id,
        &input.temp_id,
        artifact_id.as_str(),
        &content,
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    log.mark_accepted(
        &generation.id,
        &input.temp_id,
        artifact_id.as_str(),
        &content,
    )
    .map_err(ApiError::storage)?;
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact_id.as_str().to_string(),
        },
    )
}

/// Descarta una propuesta pendiente. Idempotente; rechaza si ya se aceptó.
pub fn discard_proposal(
    log: &mut ProposalLog,
    db: &DbActor,
    input: DiscardProposalInput,
) -> Result<(), ApiError> {
    if log.generation(&input.generation_id).is_none() {
        return Err(ApiError::coded(
            "generation_not_found",
            format!("generación desconocida: {}", input.generation_id),
        ));
    }
    db.discard_proposal(&input.generation_id, &input.temp_id)
        .map_err(ApiError::storage)?;
    log.mark_discarded(&input.generation_id, &input.temp_id)
        .map_err(ApiError::storage)?;
    Ok(())
}
