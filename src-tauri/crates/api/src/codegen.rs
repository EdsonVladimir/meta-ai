//! Code generations: versioned context, recording and acceptance.
//!
//! Flow: `snapshot_code_context` (or `snapshot_code_context_from_screen`)
//! freezes the origin —current requirement or saved screen with its
//! exact sources— and reads the scope from disk (SAVED content,
//! with fingerprints); the command calls Meta off the lock;
//! `record_code_generation` persists the validated proposal; accepting
//! writes EACH file to disk with its expected fingerprint and only then
//! marks the state.
//!
//! Rules: no generation without scope; archived items block; proposed
//! roots must be authorized; accepting requires a current origin and
//! an intact scope (any change blocks and asks to regenerate); creating
//! never overwrites; `modify` requires the at-generation captured fingerprint;
//! double accept never writes twice. Staleness COMPUTES
//! (`generation_freshness`), never stores.

use std::collections::HashSet;
use std::path::PathBuf;

use ruth_code::CodeWorkspace;
use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, CoreError, ModuleId, ProjectId};
use ruth_meta::code::{
    ValidatedCode, CODE_TEMPLATE_VERSION, MAX_CODE_SCREEN_CHARS, MOCKUP_CODE_TEMPLATE_VERSION,
};
use ruth_meta::generation::GenerationContextItem;
use ruth_meta::protocol::TokenUsage;
use ruth_store::{
    CodeFileState, CodeGenLog, CodeScopeEntry, DbActor, ScreenSourceRef, StoredCodeGeneration,
    StoredProposalFile,
};

use crate::error::ApiError;
use crate::ids::IdGen;

fn coded(kind: &str, message: impl Into<String>) -> ApiError {
    ApiError::coded(kind, message)
}

fn code_err(err: ruth_code::CodeError) -> ApiError {
    coded(err.kind(), err.message().to_string())
}

/// Scope file requested by the frontend (root + relative path).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeFileInput {
    pub root_id: String,
    pub rel: String,
}

/// Scope file read from disk, with fingerprint and content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeScopeRead {
    pub root_id: String,
    pub rel: String,
    pub fingerprint: String,
    pub bytes: u64,
    pub content: String,
}

/// Source requirement cited by the screen, at its exact version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeScreenSourceItem {
    pub artifact_id: String,
    pub version_id: String,
    pub content: String,
}

/// Frozen origin screen: mockup + screen + the mockup's exact
/// version, screen summary and resolved sources.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeScreenContext {
    pub mockup_artifact_id: String,
    pub mockup_version_id: String,
    pub screen_id: String,
    pub screen_title: String,
    pub screen_text: String,
    pub sources: Vec<CodeScreenSourceItem>,
}

/// Frozen context for generating: exact origin (requirement or
/// screen) + read scope. With a screen, the requirement fields
/// travel empty and `screen` rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeGenContext {
    pub project_id: String,
    pub module_id: String,
    pub artifact_id: String,
    pub version_id: String,
    pub requirement_content: String,
    pub screen: Option<CodeScreenContext>,
    pub files: Vec<CodeScopeRead>,
}

/// Freezes the context: the module's current requirement (no approval
/// required, as in living design) and scope read from disk with
/// its fingerprints. Empty, repeated or illegible scope: an honest
/// error before consuming network. Rejects archived items.
pub fn snapshot_code_context(
    store: &Store,
    roots: &CodeWorkspace,
    project_id: &str,
    module_id: &str,
    artifact_id: &str,
    scope: &[ScopeFileInput],
) -> Result<CodeGenContext, ApiError> {
    if scope.is_empty() {
        return Err(coded(
            "empty_scope",
            "Add at least one file to the scope for proposing code.",
        ));
    }
    if scope.len() > ruth_meta::code::MAX_CODE_SCOPE_FILES {
        return Err(coded(
            "scope_too_large",
            "Too many files in the scope for proposing code.",
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
    let artifact = ArtifactId::new(artifact_id.to_string())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    if known.project() != &project || known.module() != &module {
        return Err(coded(
            "foreign_requirement",
            format!("{artifact_id} does not belong to this module"),
        ));
    }
    if known.artifact_type() != ArtifactType::Requirement {
        return Err(coded(
            "not_a_requirement",
            format!("{artifact_id} is not a requirement"),
        ));
    }
    if store.is_effectively_archived(&artifact) {
        return Err(CoreError::ArchivedArtifact { artifact }.into());
    }
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal(format!("{artifact_id} has no versions")));
    };
    let files = read_scope_files(roots, scope)?;
    Ok(CodeGenContext {
        project_id: project_id.to_string(),
        module_id: module_id.to_string(),
        artifact_id: artifact_id.to_string(),
        version_id: current.id().as_str().to_string(),
        requirement_content: current.content().as_str().to_string(),
        screen: None,
        files,
    })
}

/// Reads the scope from disk with fingerprints: no duplicates,
/// authorized roots and saved content. Stable order (root, path).
fn read_scope_files(
    roots: &CodeWorkspace,
    scope: &[ScopeFileInput],
) -> Result<Vec<CodeScopeRead>, ApiError> {
    let mut seen = HashSet::new();
    let mut files = Vec::with_capacity(scope.len());
    for entry in scope {
        if !seen.insert((entry.root_id.clone(), entry.rel.clone())) {
            return Err(coded(
                "duplicate_scope",
                format!(
                    "file repeated in the scope: {}/{}",
                    entry.root_id, entry.rel
                ),
            ));
        }
        let Some(root) = roots.get(&entry.root_id) else {
            return Err(coded(
                "code_root_not_found",
                format!("Folder \"{}\" outside the workspace", entry.root_id),
            ));
        };
        let read =
            ruth_code::read_file(&PathBuf::from(&root.path), &entry.rel).map_err(code_err)?;
        files.push(CodeScopeRead {
            root_id: entry.root_id.clone(),
            rel: entry.rel.clone(),
            fingerprint: read.fingerprint,
            bytes: read.size,
            content: read.text,
        });
    }
    files.sort_by(|a, b| (&a.root_id, &a.rel).cmp(&(&b.root_id, &b.rel)));
    Ok(files)
}

/// Freezes the context from ONE saved screen: the mockup's current
/// version, the existing screen with its summary and cited sources
/// resolved to their exact versions. No generation without scope; the
/// mockup, a missing screen, corrupt content or a lost, foreign or
/// archived source block with the concrete reason.
pub fn snapshot_code_context_from_screen(
    store: &Store,
    roots: &CodeWorkspace,
    project_id: &str,
    module_id: &str,
    mockup_id: &str,
    screen_id: &str,
    scope: &[ScopeFileInput],
) -> Result<CodeGenContext, ApiError> {
    if scope.is_empty() {
        return Err(coded(
            "empty_scope",
            "Add at least one file to the scope for proposing code.",
        ));
    }
    if scope.len() > ruth_meta::code::MAX_CODE_SCOPE_FILES {
        return Err(coded(
            "scope_too_large",
            "Too many files in the scope for proposing code.",
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
    let artifact = ArtifactId::new(mockup_id.to_string())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    if known.project() != &project || known.module() != &module {
        return Err(coded(
            "foreign_mockup",
            format!("{mockup_id} does not belong to this module"),
        ));
    }
    if known.artifact_type() != ArtifactType::Mockup {
        return Err(coded(
            "not_a_mockup",
            format!("{mockup_id} is not a mockup"),
        ));
    }
    if store.is_effectively_archived(&artifact) {
        return Err(CoreError::ArchivedArtifact { artifact }.into());
    }
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal(format!("{mockup_id} has no versions")));
    };
    let spec =
        ruth_meta::mockup::parse_mockup_spec(current.content().as_str()).ok_or_else(|| {
            coded(
                "mockup_invalid",
                format!("Mockup {mockup_id} has unstructured content."),
            )
        })?;
    let screen = spec
        .screens
        .iter()
        .find(|s| s.id == screen_id)
        .ok_or_else(|| {
            coded(
                "screen_not_found",
                format!("Screen \"{screen_id}\" no longer exists in {mockup_id}."),
            )
        })?;
    let screen_text = ruth_meta::mockup::render_mockup_screen_excerpt(
        current.content().as_str(),
        screen_id,
        MAX_CODE_SCREEN_CHARS,
    )
    .unwrap_or_else(|| "(screen without components)".to_string());
    let mut refs: Vec<String> = screen.requirements.clone();
    for component in &screen.components {
        refs.extend(component.requirements.iter().cloned());
    }
    refs.sort();
    refs.dedup();
    let mut sources = Vec::with_capacity(refs.len());
    for ref_id in refs {
        let ref_artifact = ArtifactId::new(ref_id.clone()).map_err(|_| {
            coded(
                "screen_source_invalid",
                format!("The screen cites an invalid source: {ref_id}."),
            )
        })?;
        let Some(source) = store.artifact(&ref_artifact) else {
            return Err(coded(
                "screen_source_missing",
                format!("The screen cites {ref_id}, which no longer exists."),
            ));
        };
        if source.artifact_type() != ArtifactType::Requirement
            || source.project() != &project
            || source.module() != &module
        {
            return Err(coded(
                "screen_source_invalid",
                format!("The screen cites an invalid source: {ref_id}."),
            ));
        }
        if store.is_effectively_archived(&ref_artifact) {
            return Err(CoreError::ArchivedArtifact {
                artifact: ref_artifact,
            }
            .into());
        }
        let Some(version) = store.current_version(&ref_artifact) else {
            return Err(ApiError::internal(format!("{ref_id} has no versions")));
        };
        sources.push(CodeScreenSourceItem {
            artifact_id: ref_id,
            version_id: version.id().as_str().to_string(),
            content: version.content().as_str().to_string(),
        });
    }
    let files = read_scope_files(roots, scope)?;
    Ok(CodeGenContext {
        project_id: project_id.to_string(),
        module_id: module_id.to_string(),
        artifact_id: String::new(),
        version_id: String::new(),
        requirement_content: String::new(),
        screen: Some(CodeScreenContext {
            mockup_artifact_id: mockup_id.to_string(),
            mockup_version_id: current.id().as_str().to_string(),
            screen_id: screen.id.clone(),
            screen_title: screen.title.clone(),
            screen_text,
            sources,
        }),
        files,
    })
}

/// Context requirement in the shape the prompt asks for.
pub fn context_requirement(context: &CodeGenContext) -> GenerationContextItem {
    GenerationContextItem {
        artifact_id: context.artifact_id.clone(),
        version_id: context.version_id.clone(),
        content: context.requirement_content.clone(),
    }
}

/// Context screen in the shape the prompt asks for (`None` with
/// a requirement origin).
pub fn context_screen(context: &CodeGenContext) -> Option<ruth_meta::code::CodeScreenSource> {
    let screen = context.screen.as_ref()?;
    Some(ruth_meta::code::CodeScreenSource {
        mockup_artifact_id: screen.mockup_artifact_id.clone(),
        version_id: screen.mockup_version_id.clone(),
        screen_id: screen.screen_id.clone(),
        screen_title: screen.screen_title.clone(),
        screen_text: screen.screen_text.clone(),
        requirements: screen
            .sources
            .iter()
            .map(|source| GenerationContextItem {
                artifact_id: source.artifact_id.clone(),
                version_id: source.version_id.clone(),
                content: source.content.clone(),
            })
            .collect(),
    })
}

/// Validated input for recording a newly produced generation.
pub struct RecordCodeGenInput {
    pub context: CodeGenContext,
    pub code: ValidatedCode,
    pub model: String,
    pub usage: Option<TokenUsage>,
    pub created_at: String,
}

/// Builds the persistable log: proposed roots must be authorized
/// in the workspace (coming from the model is not enough). Each
/// `modify`'s expected fingerprint is the scope's when the file
/// was in it; when modifying outside the scope is proposed, the
/// current on-disk fingerprint is taken (and accepting revalidates anyway).
pub fn build_stored_codegen(
    roots: &CodeWorkspace,
    ids: &mut IdGen,
    input: RecordCodeGenInput,
) -> Result<StoredCodeGeneration, ApiError> {
    let mut files = Vec::with_capacity(input.code.files.len());
    for (pos, file) in input.code.files.iter().enumerate() {
        let Some(root) = roots.get(&file.root_id) else {
            return Err(coded(
                "code_root_not_found",
                format!("Folder \"{}\" outside the workspace", file.root_id),
            ));
        };
        let expected_fingerprint = match file.operation {
            ruth_meta::code::CodeOperation::Create => None,
            ruth_meta::code::CodeOperation::Modify => {
                if let Some(known) = input
                    .context
                    .files
                    .iter()
                    .find(|read| read.root_id == file.root_id && read.rel == file.rel)
                {
                    Some(known.fingerprint.clone())
                } else {
                    let read = ruth_code::read_file(&PathBuf::from(&root.path), &file.rel)
                        .map_err(code_err)?;
                    Some(read.fingerprint)
                }
            }
        };
        files.push(StoredProposalFile {
            pos: pos as u32,
            root_id: file.root_id.clone(),
            rel: file.rel.clone(),
            operation: file.operation.as_str().to_string(),
            expected_fingerprint,
            content: file.content.clone(),
            state: CodeFileState::Pending,
            decided_at: None,
        });
    }
    let screen_sourced = input.context.screen.is_some();
    let (screen_artifact_id, screen_id, screen_version_id, screen_sources) =
        match input.context.screen.as_ref() {
            Some(screen) => (
                screen.mockup_artifact_id.clone(),
                screen.screen_id.clone(),
                screen.mockup_version_id.clone(),
                screen
                    .sources
                    .iter()
                    .map(|source| ScreenSourceRef {
                        artifact_id: source.artifact_id.clone(),
                        version_id: source.version_id.clone(),
                    })
                    .collect(),
            ),
            None => (String::new(), String::new(), String::new(), Vec::new()),
        };
    Ok(StoredCodeGeneration {
        id: ids.code_generation(),
        project_id: input.context.project_id.clone(),
        module_id: input.context.module_id.clone(),
        requirement_artifact_id: if screen_sourced {
            String::new()
        } else {
            input.context.artifact_id.clone()
        },
        requirement_version_id: if screen_sourced {
            String::new()
        } else {
            input.context.version_id.clone()
        },
        screen_artifact_id,
        screen_id,
        screen_version_id,
        screen_sources,
        model: input.model,
        template_version: if screen_sourced {
            MOCKUP_CODE_TEMPLATE_VERSION
        } else {
            CODE_TEMPLATE_VERSION
        },
        input_tokens: input.usage.as_ref().map(|u| u.input_tokens),
        output_tokens: input.usage.as_ref().map(|u| u.output_tokens),
        total_tokens: input.usage.as_ref().map(|u| u.total_tokens),
        created_at: input.created_at,
        explanation: input.code.explanation.clone(),
        scope: input
            .context
            .files
            .iter()
            .map(|read| CodeScopeEntry {
                root_id: read.root_id.clone(),
                rel: read.rel.clone(),
                fingerprint: read.fingerprint.clone(),
            })
            .collect(),
        assumptions: input.code.assumptions.clone(),
        questions: input.code.questions.clone(),
        files,
    })
}

/// Records the generation: disk (SQLite) first, then memory. The id
/// is fresh (`cgen-N`), so the memory log never fails duplicated
/// after a correct commit.
pub fn record_code_generation(
    db: &DbActor,
    log: &mut CodeGenLog,
    ids: &mut IdGen,
    roots: &CodeWorkspace,
    input: RecordCodeGenInput,
) -> Result<StoredCodeGeneration, ApiError> {
    let generation = build_stored_codegen(roots, ids, input)?;
    db.record_codegen(&generation, ids.checkpoint())
        .map_err(ApiError::storage)?;
    log.record(generation.clone()).map_err(ApiError::storage)?;
    Ok(generation)
}

/// Change detected in a scope entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeChange {
    pub root_id: String,
    pub rel: String,
    /// `changed` (another fingerprint), `missing` (no longer readable) or `root_gone`.
    pub reason: String,
}

/// Screen source that no longer matches: `changed` (another version)
/// or `missing` (no longer exists or has no current version).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenSourceChange {
    pub artifact_id: String,
    pub reason: String,
}

/// Computed freshness of a generation: moved or deleted origin
/// (requirement or screen with its sources) and scope entries that
/// no longer match. Everything rereads; nothing saves here.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CodeGenFreshness {
    pub requirement_moved: bool,
    pub requirement_missing: bool,
    pub screen_moved: bool,
    pub screen_missing: bool,
    pub changed_sources: Vec<ScreenSourceChange>,
    pub changed_scope: Vec<ScopeChange>,
}

impl CodeGenFreshness {
    pub fn stale(&self) -> bool {
        self.requirement_moved
            || self.requirement_missing
            || self.screen_moved
            || self.screen_missing
            || !self.changed_sources.is_empty()
            || !self.changed_scope.is_empty()
    }
}

pub fn generation_freshness(
    store: &Store,
    roots: &CodeWorkspace,
    generation: &StoredCodeGeneration,
) -> CodeGenFreshness {
    let mut freshness = CodeGenFreshness::default();
    if generation.is_screen_sourced() {
        let Ok(artifact) = ArtifactId::new(generation.screen_artifact_id.clone()) else {
            freshness.screen_missing = true;
            return freshness;
        };
        match store
            .artifact(&artifact)
            .and_then(|_| store.current_version(&artifact))
        {
            None => freshness.screen_missing = true,
            Some(current) if current.id().as_str() != generation.screen_version_id => {
                freshness.screen_moved = true;
            }
            Some(_) => {}
        }
        for source in &generation.screen_sources {
            let stale = match ArtifactId::new(source.artifact_id.clone())
                .ok()
                .and_then(|id| store.current_version(&id))
            {
                None => Some("missing"),
                Some(current) if current.id().as_str() != source.version_id => Some("changed"),
                Some(_) => None,
            };
            if let Some(reason) = stale {
                freshness.changed_sources.push(ScreenSourceChange {
                    artifact_id: source.artifact_id.clone(),
                    reason: reason.to_string(),
                });
            }
        }
    } else {
        let Ok(artifact) = ArtifactId::new(generation.requirement_artifact_id.clone()) else {
            freshness.requirement_missing = true;
            return freshness;
        };
        match store
            .artifact(&artifact)
            .and_then(|_| store.current_version(&artifact))
        {
            None => freshness.requirement_missing = true,
            Some(current) if current.id().as_str() != generation.requirement_version_id => {
                freshness.requirement_moved = true;
            }
            Some(_) => {}
        }
    }
    for entry in &generation.scope {
        let Some(root) = roots.get(&entry.root_id) else {
            freshness.changed_scope.push(ScopeChange {
                root_id: entry.root_id.clone(),
                rel: entry.rel.clone(),
                reason: "root_gone".to_string(),
            });
            continue;
        };
        match ruth_code::fingerprint_matches(
            &PathBuf::from(&root.path),
            &entry.rel,
            &entry.fingerprint,
        )
        .map_err(code_err)
        {
            Ok(true) => {}
            Ok(false) => freshness.changed_scope.push(ScopeChange {
                root_id: entry.root_id.clone(),
                rel: entry.rel.clone(),
                reason: "changed".to_string(),
            }),
            Err(_) => freshness.changed_scope.push(ScopeChange {
                root_id: entry.root_id.clone(),
                rel: entry.rel.clone(),
                reason: "missing".to_string(),
            }),
        }
    }
    freshness
}

/// File ready to write, after all checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptReady {
    pub root_id: String,
    pub rel: String,
    pub create: bool,
    pub expected_fingerprint: Option<String>,
    pub content: String,
}

/// Result of validating an acceptance: ready, or already accepted
/// before (idempotent: the caller does NOT write again).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcceptCheck {
    Ready(AcceptReady),
    AlreadyAccepted,
}

/// Validates accepting a file: pending, current origin (requirement
/// or screen with its sources), intact scope and coherent destination
/// (`modify` with a current fingerprint, `create` with an empty destination).
/// Any staleness blocks with the concrete reason;
/// regenerating is explicit.
pub fn check_accept(
    store: &Store,
    roots: &CodeWorkspace,
    log: &CodeGenLog,
    generation_id: &str,
    pos: u32,
) -> Result<AcceptCheck, ApiError> {
    let Some(generation) = log.get(generation_id) else {
        return Err(coded(
            "unknown_generation",
            format!("unknown code generation: {generation_id}"),
        ));
    };
    let Some(file) = generation.files.iter().find(|f| f.pos == pos) else {
        return Err(coded(
            "unknown_file",
            format!("unknown file {pos} in {generation_id}"),
        ));
    };
    match file.state {
        CodeFileState::Accepted => return Ok(AcceptCheck::AlreadyAccepted),
        CodeFileState::Discarded => {
            return Err(coded(
                "file_discarded",
                format!("file {pos} of {generation_id} is discarded"),
            ));
        }
        CodeFileState::Pending => {}
    }
    let freshness = generation_freshness(store, roots, generation);
    if generation.is_screen_sourced() {
        if freshness.screen_missing {
            return Err(coded(
                "stale_screen",
                "The origin screen no longer exists; generate a new proposal.",
            ));
        }
        if freshness.screen_moved {
            return Err(coded(
                "stale_screen",
                "The screen changed since the generation; generate a new proposal.",
            ));
        }
        if let Some(source) = freshness.changed_sources.first() {
            let what = if source.reason == "missing" {
                "no longer exists"
            } else {
                "changed since the generation"
            };
            return Err(coded(
                "stale_screen_source",
                format!(
                    "Requirement {} of the screen {what}; generate a new proposal.",
                    source.artifact_id
                ),
            ));
        }
    } else {
        if freshness.requirement_missing {
            return Err(coded(
                "stale_requirement",
                "The origin requirement no longer exists; generate a new proposal.",
            ));
        }
        if freshness.requirement_moved {
            return Err(coded(
                "stale_requirement",
                "The requirement changed since the generation; generate a new proposal.",
            ));
        }
    }
    if let Some(change) = freshness.changed_scope.first() {
        return Err(coded(
            "stale_scope",
            format!(
                "The scope changed ({}/{}); generate a new proposal.",
                change.root_id, change.rel
            ),
        ));
    }
    let Some(root) = roots.get(&file.root_id) else {
        return Err(coded(
            "code_root_not_found",
            format!("Folder \"{}\" outside the workspace", file.root_id),
        ));
    };
    let root_path = PathBuf::from(&root.path);
    let create = file.operation == "create";
    if create {
        if ruth_code::file_exists(&root_path, &file.rel).map_err(code_err)? {
            return Err(code_err(ruth_code::CodeError::already_exists(&file.rel)));
        }
    } else {
        let Some(expected) = file.expected_fingerprint.as_deref() else {
            return Err(ApiError::internal(format!(
                "file {pos} of {generation_id} has no expected fingerprint"
            )));
        };
        let matches =
            ruth_code::fingerprint_matches(&root_path, &file.rel, expected).map_err(code_err)?;
        if !matches {
            return Err(code_err(ruth_code::CodeError::conflict(&file.rel)));
        }
    }
    Ok(AcceptCheck::Ready(AcceptReady {
        root_id: file.root_id.clone(),
        rel: file.rel.clone(),
        create,
        expected_fingerprint: file.expected_fingerprint.clone(),
        content: file.content.clone(),
    }))
}

/// Proposable screen: stable identity + readable title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockupScreenEntry {
    pub id: String,
    pub title: String,
}

/// Proposable mockup with its screens, at its current version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockupScreens {
    pub artifact_id: String,
    pub title: String,
    pub version_id: String,
    pub screens: Vec<MockupScreenEntry>,
}

/// The module's proposable mockups with their screens (current
/// versions, no drafts). Out: archived (individually or by
/// module), without a current version, with unstructured content or
/// without screens (none of that could freeze as an origin). Stable
/// order by artifact; screens in spec order.
pub fn list_mockup_screens(
    store: &Store,
    project_id: &str,
    module_id: &str,
) -> Result<Vec<MockupScreens>, ApiError> {
    let project = ProjectId::new(project_id.to_string())?;
    let module = ModuleId::new(module_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut out = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        if artifact.artifact_type() != ArtifactType::Mockup {
            continue;
        }
        if store.is_effectively_archived(artifact.id()) {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        let Some(spec) = ruth_meta::mockup::parse_mockup_spec(current.content().as_str()) else {
            continue;
        };
        if spec.screens.is_empty() {
            continue;
        }
        out.push(MockupScreens {
            artifact_id: artifact.id().as_str().to_string(),
            title: artifact.title().unwrap_or(spec.title.as_str()).to_string(),
            version_id: current.id().as_str().to_string(),
            screens: spec
                .screens
                .iter()
                .map(|screen| MockupScreenEntry {
                    id: screen.id.clone(),
                    title: screen.title.clone(),
                })
                .collect(),
        });
    }
    Ok(out)
}

/// Discards a pending file: disk first, then memory.
/// Idempotent; accepted cannot be discarded.
pub fn discard_code_file(
    db: &DbActor,
    log: &mut CodeGenLog,
    generation_id: &str,
    pos: u32,
    decided_at: &str,
) -> Result<(), ApiError> {
    db.discard_code_file(generation_id, pos, decided_at)
        .map_err(ApiError::storage)?;
    log.mark_file_discarded(generation_id, pos, decided_at)
        .map_err(ApiError::storage)?;
    Ok(())
}
