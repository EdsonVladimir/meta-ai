//! Structure-replication commands: folders → empty modules.
//!
//! - `code_replicate_preview`: suggested or chosen base + candidate
//!   child folders with their link state. Read-only.
//! - `code_replicate_execute`: creates in ONE transaction the project (if
//!   new), empty modules, the root↔project association and manual
//!   links; publishes in memory only after confirming the save.

use tauri::State;

use ruth_api::ApiError;

use super::code::CodeRootDto;
use super::{lock, ready};
use crate::state::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicatePreviewInput {
    pub root_id: String,
    pub base: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicateEntryDto {
    pub name: String,
    pub rel: String,
    pub linked_module: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicatePreviewDto {
    pub root_id: String,
    pub base: String,
    pub suggested: bool,
    pub reason: String,
    pub entries: Vec<ReplicateEntryDto>,
    pub excluded: Vec<String>,
    pub truncated: bool,
    pub over_cap: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReplicateTargetInput {
    New { name: String },
    Existing { project_id: String },
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicateExecuteInput {
    pub root_id: String,
    pub base: String,
    pub rels: Vec<String>,
    pub target: ReplicateTargetInput,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicatedModuleDto {
    pub module_id: String,
    pub name: String,
    pub rel: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicateResultDto {
    pub project_id: String,
    pub project_name: String,
    pub project_created: bool,
    pub modules: Vec<ReplicatedModuleDto>,
    pub already_linked: Vec<String>,
    pub root: CodeRootDto,
}

#[tauri::command]
pub fn code_replicate_preview(
    state: State<'_, AppState>,
    input: ReplicatePreviewInput,
) -> Result<ReplicatePreviewDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = super::code::workspace_of(ready.code_roots);
    let Some(root) = roots.get(&input.root_id) else {
        return Err(ApiError::coded(
            "code_root_not_found",
            "Folder outside the workspace",
        ));
    };
    let preview =
        ruth_api::preview_replication(ready.store, ready.code_links, root, input.base.as_deref())?;
    Ok(ReplicatePreviewDto {
        root_id: preview.root_id,
        base: preview.base,
        suggested: preview.suggested,
        reason: preview.reason,
        entries: preview
            .entries
            .into_iter()
            .map(|entry| ReplicateEntryDto {
                name: entry.name,
                rel: entry.rel,
                linked_module: entry.linked_module,
            })
            .collect(),
        excluded: preview.excluded,
        truncated: preview.truncated,
        over_cap: preview.over_cap,
    })
}

#[tauri::command]
pub fn code_replicate_execute(
    state: State<'_, AppState>,
    input: ReplicateExecuteInput,
) -> Result<ReplicateResultDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = super::code::workspace_of(ready.code_roots);
    // Pure plan over the confirmed state: validates root, target,
    // base, selection and idempotence without mutating anything.
    let plan = ruth_api::plan_replication(
        ready.store,
        &roots,
        ready.code_links,
        &ruth_api::ReplicateInput {
            root_id: input.root_id,
            base: input.base,
            rels: input.rels,
            target: match input.target {
                ReplicateTargetInput::New { name } => ruth_api::ReplicateTarget::New { name },
                ReplicateTargetInput::Existing { project_id } => {
                    ruth_api::ReplicateTarget::Existing { project_id }
                }
            },
        },
    )?;
    // Drafts: domain + ids + links. Nothing publishes until the
    // single save below is confirmed.
    let mut store = ready.store.clone();
    let mut ids = ready.ids.clone();
    let applied = ruth_api::apply_replication(&mut store, &mut ids, &plan)?;
    let links = ruth_api::build_replication_links(
        &store,
        roots.roots(),
        ready.code_links,
        &mut ids,
        &plan.root_id,
        &applied,
        &ruth_api::now_utc_iso8601(),
    )?;
    let mut new_roots = roots.roots().to_vec();
    let Some(root) = new_roots.iter_mut().find(|r| r.id == plan.root_id) else {
        return Err(ApiError::internal("the root vanished mid-replication"));
    };
    root.project_id = Some(applied.project_id.clone());
    // ONE transaction: domain + roots + links or nothing.
    ready
        .db
        .save_replication(&store, &new_roots, &links, ids.checkpoint())
        .map_err(ApiError::storage)?;
    *ready.store = store;
    *ready.ids = ids;
    let mut log = ruth_store::CodeRootLog::new();
    for root in &new_roots {
        log.rehydrate(
            root.id.clone(),
            root.path.clone(),
            root.name.clone(),
            root.project_id.clone(),
        );
    }
    *ready.code_roots = log;
    for link in &links {
        ready
            .code_links
            .record(link.clone())
            .map_err(ApiError::storage)?;
    }
    let project_id = applied.project_id.clone();
    let project_name = ready
        .store
        .project(&ruth_core::domain::ProjectId::new(project_id.clone())?)
        .map(|project| project.name().to_string())
        .unwrap_or_else(|| project_id.clone());
    let root = new_roots
        .iter()
        .find(|r| r.id == plan.root_id)
        .expect("the root exists: it was just saved");
    Ok(ReplicateResultDto {
        project_id,
        project_name,
        project_created: applied.project_created,
        modules: applied
            .modules
            .into_iter()
            .map(|module| ReplicatedModuleDto {
                module_id: module.module_id,
                name: module.name,
                rel: module.rel,
            })
            .collect(),
        already_linked: plan.already_linked,
        root: CodeRootDto::of(root),
    })
}
