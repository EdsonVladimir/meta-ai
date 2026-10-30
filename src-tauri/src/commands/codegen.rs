//! Code-proposal commands with Meta (living diagrams).
//!
//! - `code_gen_context`: network-free preview (exact source —
//!   requirement or screen with its sources — + scope with sizes and
//!   fingerprints, without contents).
//! - `code_mockup_screens`: proposable mockups with their screens.
//! - `code_generate`: generates with Meta and records. The network runs WITHOUT
//!   locks: context snapshot, release, network, then later recording.
//!   Shares the one-inflight-generation-per-module mark.
//! - `code_list_generations`: the module's proposals with their freshness
//!   computed (requirement and scope re-read, nothing stored).
//! - `code_accept_file`: validates, writes ONE file to disk and marks
//!   the state. Disk first: if SQLite fails after, the error is
//!   honest (written but pending) and the retry hits the fingerprint
//!   instead of writing twice.
//! - `code_discard_file`: discards a pending file (idempotent).

use tauri::State;

use ruth_api::{
    now_utc_iso8601, AcceptCheck, ApiError, CodeGenFreshness, RecordCodeGenInput, ScopeFileInput,
};

use crate::state::AppState;

use super::code::workspace_of;
use super::{lock, mark_inflight, ready, InflightGuard};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeScopeFileInput {
    pub root_id: String,
    pub rel: String,
}

/// Source of the proposal: ONE requirement or ONE mockup screen.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CodeGenSourceInput {
    Requirement {
        artifact_id: String,
    },
    Screen {
        mockup_id: String,
        screen_id: String,
    },
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGenContextInput {
    pub project_id: String,
    pub module_id: String,
    pub source: CodeGenSourceInput,
    pub scope: Vec<CodeScopeFileInput>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeScopeReadDto {
    pub root_id: String,
    pub rel: String,
    pub fingerprint: String,
    pub bytes: u64,
    pub chars: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeScreenSourceDto {
    pub artifact_id: String,
    pub version_id: String,
    pub chars: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGenContextDto {
    pub project_id: String,
    pub module_id: String,
    /// Source: requirement or mockup, with its exact version.
    pub artifact_id: String,
    pub version_id: String,
    pub requirement_chars: usize,
    /// Source screen (empty/zero with requirement source).
    pub screen_id: String,
    pub screen_title: String,
    pub screen_chars: usize,
    pub screen_sources: Vec<CodeScreenSourceDto>,
    pub files: Vec<CodeScopeReadDto>,
    pub total_chars: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeProposalFileDto {
    pub pos: u32,
    pub root_id: String,
    pub rel: String,
    pub operation: String,
    pub state: String,
    pub decided_at: Option<String>,
    pub content: String,
    pub expected_fingerprint: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGenScopeDto {
    pub root_id: String,
    pub rel: String,
    pub fingerprint: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeUsageDto {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeScreenSourceRefDto {
    pub artifact_id: String,
    pub version_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGenerationDto {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub requirement_artifact_id: String,
    pub requirement_version_id: String,
    /// Source screen (empty with requirement source) and its sources.
    pub screen_artifact_id: String,
    pub screen_id: String,
    pub screen_version_id: String,
    pub screen_sources: Vec<CodeScreenSourceRefDto>,
    pub model: String,
    pub template_version: u32,
    pub usage: CodeUsageDto,
    pub created_at: String,
    pub explanation: String,
    pub assumptions: Vec<String>,
    pub questions: Vec<String>,
    pub scope: Vec<CodeGenScopeDto>,
    pub files: Vec<CodeProposalFileDto>,
    pub stale: bool,
    pub stale_reason: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeListInput {
    pub module_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFileInput {
    pub generation_id: String,
    pub pos: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeMockupScreenDto {
    pub id: String,
    pub title: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeMockupScreensDto {
    pub artifact_id: String,
    pub title: String,
    pub version_id: String,
    pub screens: Vec<CodeMockupScreenDto>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeMockupScreensInput {
    pub project_id: String,
    pub module_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAcceptDto {
    pub generation: CodeGenerationDto,
    pub already_accepted: bool,
    pub fingerprint: Option<String>,
    pub size: Option<u64>,
}

fn scope_inputs(scope: &[CodeScopeFileInput]) -> Vec<ScopeFileInput> {
    scope
        .iter()
        .map(|entry| ScopeFileInput {
            root_id: entry.root_id.clone(),
            rel: entry.rel.clone(),
        })
        .collect()
}

fn stale_reason(freshness: &CodeGenFreshness) -> Option<String> {
    if freshness.requirement_missing {
        return Some("The source requirement no longer exists.".to_string());
    }
    if freshness.requirement_moved {
        return Some("The requirement changed since generation.".to_string());
    }
    if freshness.screen_missing {
        return Some("The source screen no longer exists.".to_string());
    }
    if freshness.screen_moved {
        return Some("The screen changed since generation.".to_string());
    }
    if let Some(source) = freshness.changed_sources.first() {
        let what = if source.reason == "missing" {
            "no longer exists"
        } else {
            "changed since generation"
        };
        return Some(format!(
            "Requirement {} of the screen {what}.",
            source.artifact_id
        ));
    }
    freshness.changed_scope.first().map(|change| {
        let what = match change.reason.as_str() {
            "root_gone" => "the folder is no longer in the workspace",
            "missing" => "can no longer be read",
            _ => "changed on disk",
        };
        format!(
            "The scope changed: {}/{} ({what}).",
            change.root_id, change.rel
        )
    })
}

fn generation_dto(
    store: &ruth_core::application::Store,
    roots: &ruth_code::CodeWorkspace,
    generation: &ruth_store::StoredCodeGeneration,
) -> CodeGenerationDto {
    let freshness = ruth_api::generation_freshness(store, roots, generation);
    CodeGenerationDto {
        id: generation.id.clone(),
        project_id: generation.project_id.clone(),
        module_id: generation.module_id.clone(),
        requirement_artifact_id: generation.requirement_artifact_id.clone(),
        requirement_version_id: generation.requirement_version_id.clone(),
        screen_artifact_id: generation.screen_artifact_id.clone(),
        screen_id: generation.screen_id.clone(),
        screen_version_id: generation.screen_version_id.clone(),
        screen_sources: generation
            .screen_sources
            .iter()
            .map(|source| CodeScreenSourceRefDto {
                artifact_id: source.artifact_id.clone(),
                version_id: source.version_id.clone(),
            })
            .collect(),
        model: generation.model.clone(),
        template_version: generation.template_version,
        usage: CodeUsageDto {
            input_tokens: generation.input_tokens,
            output_tokens: generation.output_tokens,
            total_tokens: generation.total_tokens,
        },
        created_at: generation.created_at.clone(),
        explanation: generation.explanation.clone(),
        assumptions: generation.assumptions.clone(),
        questions: generation.questions.clone(),
        scope: generation
            .scope
            .iter()
            .map(|entry| CodeGenScopeDto {
                root_id: entry.root_id.clone(),
                rel: entry.rel.clone(),
                fingerprint: entry.fingerprint.clone(),
            })
            .collect(),
        files: generation
            .files
            .iter()
            .map(|file| CodeProposalFileDto {
                pos: file.pos,
                root_id: file.root_id.clone(),
                rel: file.rel.clone(),
                operation: file.operation.clone(),
                state: file.state.as_str().to_string(),
                decided_at: file.decided_at.clone(),
                content: file.content.clone(),
                expected_fingerprint: file.expected_fingerprint.clone(),
            })
            .collect(),
        stale: freshness.stale(),
        stale_reason: stale_reason(&freshness),
    }
}

fn code_err(err: ruth_code::CodeError) -> ApiError {
    ApiError::coded(err.kind(), err.message().to_string())
}

fn snapshot_for(
    store: &ruth_core::application::Store,
    roots: &ruth_code::CodeWorkspace,
    input: &CodeGenContextInput,
) -> Result<ruth_api::CodeGenContext, ApiError> {
    let scope = scope_inputs(&input.scope);
    match &input.source {
        CodeGenSourceInput::Requirement { artifact_id } => ruth_api::snapshot_code_context(
            store,
            roots,
            &input.project_id,
            &input.module_id,
            artifact_id,
            &scope,
        ),
        CodeGenSourceInput::Screen {
            mockup_id,
            screen_id,
        } => ruth_api::snapshot_code_context_from_screen(
            store,
            roots,
            &input.project_id,
            &input.module_id,
            mockup_id,
            screen_id,
            &scope,
        ),
    }
}

/// Preview of the context that will go to Meta: exact source
/// (requirement or screen with its sources) and scope with sizes and
/// fingerprints. No contents, no network.
#[tauri::command]
pub fn code_gen_context(
    state: State<'_, AppState>,
    input: CodeGenContextInput,
) -> Result<CodeGenContextDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = workspace_of(ready.code_roots);
    let context = snapshot_for(ready.store, &roots, &input)?;
    let requirement_chars = context.requirement_content.chars().count();
    let (artifact_id, version_id, screen_id, screen_title, screen_chars, screen_sources) =
        match context.screen.as_ref() {
            Some(screen) => (
                screen.mockup_artifact_id.clone(),
                screen.mockup_version_id.clone(),
                screen.screen_id.clone(),
                screen.screen_title.clone(),
                screen.screen_text.chars().count(),
                screen
                    .sources
                    .iter()
                    .map(|source| CodeScreenSourceDto {
                        artifact_id: source.artifact_id.clone(),
                        version_id: source.version_id.clone(),
                        chars: source.content.chars().count(),
                    })
                    .collect(),
            ),
            None => (
                context.artifact_id.clone(),
                context.version_id.clone(),
                String::new(),
                String::new(),
                0,
                Vec::new(),
            ),
        };
    let files: Vec<CodeScopeReadDto> = context
        .files
        .iter()
        .map(|file| CodeScopeReadDto {
            root_id: file.root_id.clone(),
            rel: file.rel.clone(),
            fingerprint: file.fingerprint.clone(),
            bytes: file.bytes,
            chars: file.content.chars().count(),
        })
        .collect();
    let total_chars = requirement_chars
        + screen_chars
        + screen_sources.iter().map(|s| s.chars).sum::<usize>()
        + files.iter().map(|f| f.chars).sum::<usize>();
    Ok(CodeGenContextDto {
        project_id: context.project_id,
        module_id: context.module_id,
        artifact_id,
        version_id,
        requirement_chars,
        screen_id,
        screen_title,
        screen_chars,
        screen_sources,
        files,
        total_chars,
    })
}

/// Generates a code proposal with Meta and records it as pending.
/// One inflight generation per module; no locks during the network.
#[tauri::command]
pub async fn code_generate(
    state: State<'_, AppState>,
    input: CodeGenContextInput,
) -> Result<CodeGenerationDto, ApiError> {
    // Short lock: saved-context snapshot and generation mark.
    let context = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let roots = workspace_of(ready.code_roots);
        let context = snapshot_for(ready.store, &roots, &input)?;
        mark_inflight(&state.inflight, &input.module_id)?;
        context
    };
    let _guard = InflightGuard::hold(&state.inflight, input.module_id.clone());

    // No locks during the network: neither SQLite nor the project state.
    let config = ruth_meta::MetaConfig::from_env().map_err(ApiError::from_meta)?;
    let scope: Vec<ruth_meta::code::CodeScopeFile> = context
        .files
        .iter()
        .map(|file| ruth_meta::code::CodeScopeFile {
            root_id: file.root_id.clone(),
            rel: file.rel.clone(),
            bytes: file.bytes,
            content: file.content.clone(),
        })
        .collect();
    let prompt = match ruth_api::context_screen(&context) {
        Some(screen) => ruth_meta::code::build_code_input_from_screen(&screen, &scope),
        None => {
            let requirement = ruth_api::context_requirement(&context);
            ruth_meta::code::build_code_input(&requirement, &scope)
        }
    };
    let allowed: Vec<String> = {
        let mut roots: Vec<String> = scope.iter().map(|f| f.root_id.clone()).collect();
        roots.sort();
        roots.dedup();
        roots
    };
    let result = ruth_meta::code::generate_code(&config, &prompt, &allowed)
        .await
        .map_err(ApiError::from_meta)?;

    // Short lock: record what validated (or nothing, if the network failed).
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = workspace_of(ready.code_roots);
    let stored = ruth_api::record_code_generation(
        ready.db,
        ready.codegen,
        ready.ids,
        &roots,
        RecordCodeGenInput {
            context,
            code: result.code,
            model: result.model,
            usage: result.usage,
            created_at: now_utc_iso8601(),
        },
    )?;
    Ok(generation_dto(ready.store, &roots, &stored))
}

/// The module's code proposals, with freshness computed on the spot.
#[tauri::command]
pub fn code_list_generations(
    state: State<'_, AppState>,
    input: CodeListInput,
) -> Result<Vec<CodeGenerationDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = workspace_of(ready.code_roots);
    Ok(ready
        .codegen
        .of_module(&input.module_id)
        .iter()
        .map(|generation| generation_dto(ready.store, &roots, generation))
        .collect())
}

/// Proposable mockups of the module with their screens, in saved
/// current versions. No network; to pick the screen source.
#[tauri::command]
pub fn code_mockup_screens(
    state: State<'_, AppState>,
    input: CodeMockupScreensInput,
) -> Result<Vec<CodeMockupScreensDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    Ok(
        ruth_api::list_mockup_screens(ready.store, &input.project_id, &input.module_id)?
            .into_iter()
            .map(|mockup| CodeMockupScreensDto {
                artifact_id: mockup.artifact_id,
                title: mockup.title,
                version_id: mockup.version_id,
                screens: mockup
                    .screens
                    .into_iter()
                    .map(|screen| CodeMockupScreenDto {
                        id: screen.id,
                        title: screen.title,
                    })
                    .collect(),
            })
            .collect(),
    )
}

/// Accepts ONE proposed file: validates, writes to disk and marks.
/// Idempotent: if already accepted it does not write again.
#[tauri::command]
pub fn code_accept_file(
    state: State<'_, AppState>,
    input: CodeFileInput,
) -> Result<CodeAcceptDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = workspace_of(ready.code_roots);
    let check = ruth_api::check_accept(
        ready.store,
        &roots,
        ready.codegen,
        &input.generation_id,
        input.pos,
    )?;
    let accepted = match check {
        AcceptCheck::AlreadyAccepted => {
            let generation = ready
                .codegen
                .get(&input.generation_id)
                .ok_or_else(|| ApiError::internal("the proposal vanished"))?;
            return Ok(CodeAcceptDto {
                generation: generation_dto(ready.store, &roots, generation),
                already_accepted: true,
                fingerprint: None,
                size: None,
            });
        }
        AcceptCheck::Ready(accepted) => accepted,
    };
    let root = roots.get(&accepted.root_id).ok_or_else(|| {
        ApiError::coded(
            "code_root_not_found",
            format!("Folder '{}' outside the workspace", accepted.root_id),
        )
    })?;
    let root_path = std::path::PathBuf::from(&root.path);
    // Disk first, state after (see the module header).
    let outcome = if accepted.create {
        ruth_code::create_file(&root_path, &accepted.rel, &accepted.content).map_err(code_err)?
    } else {
        let expected = accepted
            .expected_fingerprint
            .as_deref()
            .ok_or_else(|| ApiError::internal("the proposed file has no expected fingerprint"))?;
        ruth_code::write_file(
            &root_path,
            &accepted.rel,
            expected,
            &accepted.content,
            false,
        )
        .map_err(code_err)?
    };
    let decided_at = now_utc_iso8601();
    ready
        .db
        .accept_code_file(&input.generation_id, input.pos, &decided_at)
        .map_err(ApiError::storage)?;
    ready
        .codegen
        .mark_file_accepted(&input.generation_id, input.pos, &decided_at)
        .map_err(ApiError::storage)?;
    let generation = ready
        .codegen
        .get(&input.generation_id)
        .ok_or_else(|| ApiError::internal("the proposal vanished"))?;
    Ok(CodeAcceptDto {
        generation: generation_dto(ready.store, &roots, generation),
        already_accepted: false,
        fingerprint: Some(outcome.fingerprint),
        size: Some(outcome.size),
    })
}

/// Discards ONE pending proposed file. Idempotent.
#[tauri::command]
pub fn code_discard_file(
    state: State<'_, AppState>,
    input: CodeFileInput,
) -> Result<CodeGenerationDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = workspace_of(ready.code_roots);
    ruth_api::discard_code_file(
        ready.db,
        ready.codegen,
        &input.generation_id,
        input.pos,
        &now_utc_iso8601(),
    )?;
    let generation = ready
        .codegen
        .get(&input.generation_id)
        .ok_or_else(|| ApiError::internal("the proposal vanished"))?;
    Ok(generation_dto(ready.store, &roots, generation))
}
