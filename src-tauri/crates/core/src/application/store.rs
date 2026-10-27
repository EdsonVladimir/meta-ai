//! Estado en memoria y casos de uso del núcleo.

use std::collections::{HashMap, HashSet};

use crate::domain::{
    compute_impact, dependency_cycle, duplicate_source, find_cycle, version_is_valid, AgentId,
    Approval, Artifact, ArtifactId, ArtifactType, Author, Baseline, BaselineId, Content, CoreError,
    Date, ImpactReport, Module, ModuleId, Project, ProjectId, Provenance, Validity, Version,
    VersionId, VersionView,
};

/// Instantánea completa del estado: la forma bulk que acepta
/// [`Store::reconstitute`] tras validar. La construye el adaptador de
/// persistencia leyendo la base; nunca se genera a mano.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub modules: Vec<Module>,
    pub artifacts: Vec<Artifact>,
    pub versions: Vec<Version>,
    pub approvals: Vec<Approval>,
    pub baselines: Vec<Baseline>,
}

/// Proyectos, módulos, artefactos, versiones, aprobaciones y baselines en
/// memoria. Las consultas no mutan; los comandos validan todo antes de mutar.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Store {
    projects: HashMap<ProjectId, Project>,
    modules: HashMap<ModuleId, Module>,
    artifacts: HashMap<ArtifactId, Artifact>,
    versions: HashMap<VersionId, Version>,
    by_artifact: HashMap<ArtifactId, Vec<VersionId>>,
    approvals: Vec<Approval>,
    baselines: HashMap<BaselineId, Baseline>,
}

impl Store {
    pub fn new() -> Self {
        Self::default()
    }

    // -- Creación --

    pub fn create_project(&mut self, id: ProjectId) -> Result<Project, CoreError> {
        if self.projects.contains_key(&id) {
            return Err(CoreError::DuplicateProject { project: id });
        }
        let project = Project::new(id.clone());
        self.projects.insert(id, project.clone());
        Ok(project)
    }

    pub fn create_module(
        &mut self,
        project: &ProjectId,
        id: ModuleId,
    ) -> Result<Module, CoreError> {
        if !self.projects.contains_key(project) {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        }
        if self.modules.contains_key(&id) {
            return Err(CoreError::DuplicateModule { module: id });
        }
        let module = Module::new(id.clone(), project.clone());
        self.modules.insert(id, module.clone());
        Ok(module)
    }

    pub fn create_artifact(
        &mut self,
        project: &ProjectId,
        module: &ModuleId,
        id: ArtifactId,
        artifact_type: ArtifactType,
    ) -> Result<Artifact, CoreError> {
        if !self.projects.contains_key(project) {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        }
        let Some(module_ref) = self.modules.get(module) else {
            return Err(CoreError::ModuleNotFound {
                module: module.clone(),
            });
        };
        if module_ref.project() != project {
            return Err(CoreError::ModuleNotInProject {
                module: module.clone(),
                project: project.clone(),
            });
        }
        if self.artifacts.contains_key(&id) {
            return Err(CoreError::DuplicateArtifact { artifact: id });
        }
        let artifact = Artifact::new(id.clone(), project.clone(), module.clone(), artifact_type);
        self.artifacts.insert(id, artifact.clone());
        Ok(artifact)
    }

    /// Crea una versión nueva sin modificar las anteriores. Las fuentes son
    /// versiones exactas que deben existir, pertenecer al proyecto y no formar
    /// ciclos. `expected_current` es la versión que quien llama cree actual:
    /// `None` para la primera versión; si ya no coincide, se rechaza.
    // Entradas explícitas a propósito: identificadores, contenido y autor
    // llegan como parámetros para no leer nada fuera del dominio.
    #[allow(clippy::too_many_arguments)]
    pub fn create_version(
        &mut self,
        project: &ProjectId,
        artifact: &ArtifactId,
        expected_current: Option<&VersionId>,
        id: VersionId,
        content: Content,
        author: &Author,
        sources: &[VersionId],
    ) -> Result<Version, CoreError> {
        let artifact_ref = self.artifact_in_project(project, artifact)?;
        if self.versions.contains_key(&id) {
            return Err(CoreError::DuplicateVersion { version: id });
        }
        // El ciclo se comprueba antes de la existencia: una autorreferencia es
        // un ciclo aunque el identificador aún no exista como versión.
        let views = self.project_views(project);
        if let Some(cycle) = dependency_cycle(&id, sources, &views) {
            return Err(CoreError::DependencyCycle { cycle });
        }
        for source in sources {
            let Some(source_version) = self.versions.get(source) else {
                return Err(CoreError::VersionNotFound {
                    version: source.clone(),
                });
            };
            let source_artifact = self
                .artifacts
                .get(source_version.artifact())
                .expect("toda versión apunta a un artefacto existente");
            if source_artifact.project() != project {
                return Err(CoreError::CrossProjectDependency {
                    from: id.clone(),
                    to: source.clone(),
                });
            }
        }
        if let Some(dup) = duplicate_source(sources) {
            return Err(CoreError::DuplicateSource { source: dup });
        }
        let actual = self.current_id(artifact);
        if actual.as_ref() != expected_current {
            return Err(CoreError::StaleVersion {
                expected: expected_current.cloned(),
                actual,
            });
        }

        let number = self.by_artifact.get(artifact).map_or(0, Vec::len) as u32 + 1;
        let version = Version::new(
            id.clone(),
            artifact_ref.id().clone(),
            number,
            content,
            Provenance::from_author(author),
            sources.to_vec(),
        );
        self.versions.insert(id.clone(), version.clone());
        self.by_artifact
            .entry(artifact.clone())
            .or_default()
            .push(id);
        Ok(version)
    }

    /// Acepta contenido de IA: lo incorpora como versión nueva con procedencia
    /// de propuesta, sin aprobarla. Aceptar no equivale a aprobar.
    // Mismas entradas explícitas que `create_version`, con agente en vez de autor.
    #[allow(clippy::too_many_arguments)]
    pub fn accept_ai_draft(
        &mut self,
        project: &ProjectId,
        artifact: &ArtifactId,
        expected_current: Option<&VersionId>,
        id: VersionId,
        content: Content,
        agent: &AgentId,
        sources: &[VersionId],
    ) -> Result<Version, CoreError> {
        self.create_version(
            project,
            artifact,
            expected_current,
            id,
            content,
            &Author::Agent(agent.clone()),
            sources,
        )
    }

    /// Aprueba la versión actual de un artefacto mediante una acción humana
    /// explícita. Solo se puede aprobar la versión actual y vigente; la
    /// aprobación apunta a esa versión exacta y no se hereda.
    pub fn approve(
        &mut self,
        project: &ProjectId,
        artifact: &ArtifactId,
        expected: &VersionId,
        approver: &Author,
        at: Date,
    ) -> Result<Approval, CoreError> {
        self.artifact_in_project(project, artifact)?;
        let actual = self.current_id(artifact);
        if actual.as_ref() != Some(expected) {
            return Err(CoreError::StaleVersion {
                expected: Some(expected.clone()),
                actual,
            });
        }
        let human = match approver {
            Author::Human(human) => human,
            Author::Agent(agent) => {
                return Err(CoreError::ApproverMustBeHuman {
                    approver: agent.clone(),
                });
            }
        };
        let current = actual.expect("acaba de comprobarse que existe actual");
        let validity = self.validity(&current)?;
        if !validity.valid {
            return Err(CoreError::VersionNotValid {
                version: current,
                stale_sources: validity.stale_sources,
            });
        }
        if self
            .approvals
            .iter()
            .any(|a| a.version() == &current && a.approved_by() == human)
        {
            return Err(CoreError::DuplicateApproval {
                version: current,
                human: human.clone(),
            });
        }
        let approval = Approval::new(current, human.clone(), at);
        self.approvals.push(approval.clone());
        Ok(approval)
    }

    /// Construye una baseline coherente: entradas aprobadas, actuales y
    /// cerradas bajo fuentes. La baseline queda inmutable y reproducible.
    pub fn create_baseline(
        &mut self,
        project: &ProjectId,
        id: BaselineId,
        entries: &[(ArtifactId, VersionId)],
        at: Date,
    ) -> Result<Baseline, CoreError> {
        if !self.projects.contains_key(project) {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        }
        if self.baselines.contains_key(&id) {
            return Err(CoreError::DuplicateBaseline { baseline: id });
        }
        if entries.is_empty() {
            return Err(CoreError::EmptyBaseline);
        }
        let mut seen_artifacts = HashSet::new();
        for (artifact, _) in entries {
            if !seen_artifacts.insert(artifact) {
                return Err(CoreError::BaselineDuplicateArtifact {
                    artifact: artifact.clone(),
                });
            }
        }
        for (artifact, version) in entries {
            self.artifact_in_project(project, artifact)?;
            let Some(version_ref) = self.versions.get(version) else {
                return Err(CoreError::VersionNotFound {
                    version: version.clone(),
                });
            };
            if version_ref.artifact() != artifact {
                return Err(CoreError::BaselineMismatch {
                    artifact: artifact.clone(),
                    version: version.clone(),
                });
            }
            let current = self
                .current_id(artifact)
                .expect("el artefacto tiene versiones");
            if &current != version {
                return Err(CoreError::VersionNotCurrent {
                    version: version.clone(),
                    current,
                });
            }
            if !self.is_approved(version) {
                return Err(CoreError::VersionNotApproved {
                    version: version.clone(),
                });
            }
        }
        let pinned: HashSet<&VersionId> = entries.iter().map(|(_, v)| v).collect();
        for (_, version) in entries {
            let version_ref = self.versions.get(version).expect("validada arriba");
            for source in version_ref.sources() {
                if !pinned.contains(source) {
                    return Err(CoreError::BaselineMissingSource {
                        version: version.clone(),
                        source: source.clone(),
                    });
                }
            }
        }
        let baseline = Baseline::new(id.clone(), project.clone(), entries.to_vec(), at);
        self.baselines.insert(id, baseline.clone());
        Ok(baseline)
    }

    // -- Consultas (no mutan) --

    pub fn project(&self, id: &ProjectId) -> Option<&Project> {
        self.projects.get(id)
    }

    pub fn module(&self, id: &ModuleId) -> Option<&Module> {
        self.modules.get(id)
    }

    pub fn artifact(&self, id: &ArtifactId) -> Option<&Artifact> {
        self.artifacts.get(id)
    }

    pub fn version(&self, id: &VersionId) -> Option<&Version> {
        self.versions.get(id)
    }

    pub fn baseline(&self, id: &BaselineId) -> Option<&Baseline> {
        self.baselines.get(id)
    }

    /// Todas las baselines, ordenadas por identificador.
    pub fn baselines(&self) -> Vec<&Baseline> {
        let mut all: Vec<&Baseline> = self.baselines.values().collect();
        all.sort_by(|a, b| a.id().as_str().cmp(b.id().as_str()));
        all
    }

    /// Reconstituye un estado completo a partir de entidades ya construidas,
    /// validando las mismas invariantes que los casos de uso. Es la única vía
    /// para cargar datos persistidos: nunca reconstruye generando nuevos
    /// identificadores, números o fechas. Las baselines históricas no están
    /// obligadas a seguir siendo actuales, pero sí cerradas y aprobadas.
    pub fn reconstitute(snapshot: Snapshot) -> Result<Self, CoreError> {
        let mut store = Store::new();
        for project in snapshot.projects {
            if store.projects.contains_key(project.id()) {
                return Err(CoreError::DuplicateProject {
                    project: project.id().clone(),
                });
            }
            store.projects.insert(project.id().clone(), project);
        }
        for module in snapshot.modules {
            if store.modules.contains_key(module.id()) {
                return Err(CoreError::DuplicateModule {
                    module: module.id().clone(),
                });
            }
            if !store.projects.contains_key(module.project()) {
                return Err(CoreError::ProjectNotFound {
                    project: module.project().clone(),
                });
            }
            store.modules.insert(module.id().clone(), module);
        }
        for artifact in snapshot.artifacts {
            if store.artifacts.contains_key(artifact.id()) {
                return Err(CoreError::DuplicateArtifact {
                    artifact: artifact.id().clone(),
                });
            }
            if !store.projects.contains_key(artifact.project()) {
                return Err(CoreError::ProjectNotFound {
                    project: artifact.project().clone(),
                });
            }
            let Some(module) = store.modules.get(artifact.module()) else {
                return Err(CoreError::ModuleNotFound {
                    module: artifact.module().clone(),
                });
            };
            if module.project() != artifact.project() {
                return Err(CoreError::ModuleNotInProject {
                    module: artifact.module().clone(),
                    project: artifact.project().clone(),
                });
            }
            store.artifacts.insert(artifact.id().clone(), artifact);
        }
        for version in snapshot.versions {
            if store.versions.contains_key(version.id()) {
                return Err(CoreError::DuplicateVersion {
                    version: version.id().clone(),
                });
            }
            if !store.artifacts.contains_key(version.artifact()) {
                return Err(CoreError::ArtifactNotFound {
                    artifact: version.artifact().clone(),
                });
            }
            store.versions.insert(version.id().clone(), version);
        }
        for version in store.versions.values() {
            for source in version.sources() {
                let Some(source_version) = store.versions.get(source) else {
                    return Err(CoreError::VersionNotFound {
                        version: source.clone(),
                    });
                };
                let source_project = store
                    .artifacts
                    .get(source_version.artifact())
                    .expect("artefacto validado arriba")
                    .project();
                let own_project = store
                    .artifacts
                    .get(version.artifact())
                    .expect("artefacto validado arriba")
                    .project();
                if source_project != own_project {
                    return Err(CoreError::CrossProjectDependency {
                        from: version.id().clone(),
                        to: source.clone(),
                    });
                }
            }
            if let Some(dup) = duplicate_source(version.sources()) {
                return Err(CoreError::DuplicateSource { source: dup });
            }
        }
        // Números consecutivos desde 1 por artefacto.
        let mut by_artifact: HashMap<&ArtifactId, Vec<&Version>> = HashMap::new();
        for version in store.versions.values() {
            by_artifact
                .entry(version.artifact())
                .or_default()
                .push(version);
        }
        for (artifact, mut versions) in by_artifact {
            versions.sort_by_key(|v| v.number());
            for (index, version) in versions.iter().enumerate() {
                if version.number() != index as u32 + 1 {
                    return Err(CoreError::NonConsecutiveVersions {
                        artifact: (*artifact).clone(),
                    });
                }
            }
        }
        // Aciclicidad global.
        let views: Vec<VersionView> = store
            .versions
            .values()
            .map(|v| VersionView {
                id: v.id().clone(),
                artifact: v.artifact().clone(),
                sources: v.sources().to_vec(),
                is_current: false,
            })
            .collect();
        if let Some(cycle) = find_cycle(&views) {
            return Err(CoreError::DependencyCycle { cycle });
        }
        let mut seen_approvals = HashSet::new();
        for approval in snapshot.approvals {
            if !store.versions.contains_key(approval.version()) {
                return Err(CoreError::VersionNotFound {
                    version: approval.version().clone(),
                });
            }
            if !seen_approvals.insert((approval.version().clone(), approval.approved_by().clone()))
            {
                return Err(CoreError::DuplicateApproval {
                    version: approval.version().clone(),
                    human: approval.approved_by().clone(),
                });
            }
            store.approvals.push(approval);
        }
        for baseline in snapshot.baselines {
            if store.baselines.contains_key(baseline.id()) {
                return Err(CoreError::DuplicateBaseline {
                    baseline: baseline.id().clone(),
                });
            }
            if !store.projects.contains_key(baseline.project()) {
                return Err(CoreError::ProjectNotFound {
                    project: baseline.project().clone(),
                });
            }
            if baseline.entries().is_empty() {
                return Err(CoreError::EmptyBaseline);
            }
            let mut seen = HashSet::new();
            for (artifact, _) in baseline.entries() {
                if !seen.insert(artifact) {
                    return Err(CoreError::BaselineDuplicateArtifact {
                        artifact: artifact.clone(),
                    });
                }
            }
            for (artifact, version) in baseline.entries() {
                let Some(artifact_ref) = store.artifacts.get(artifact) else {
                    return Err(CoreError::ArtifactNotFound {
                        artifact: artifact.clone(),
                    });
                };
                if artifact_ref.project() != baseline.project() {
                    return Err(CoreError::ArtifactNotInProject {
                        artifact: artifact.clone(),
                        project: baseline.project().clone(),
                    });
                }
                let Some(version_ref) = store.versions.get(version) else {
                    return Err(CoreError::VersionNotFound {
                        version: version.clone(),
                    });
                };
                if version_ref.artifact() != artifact {
                    return Err(CoreError::BaselineMismatch {
                        artifact: artifact.clone(),
                        version: version.clone(),
                    });
                }
                if !store.approvals.iter().any(|a| a.version() == version) {
                    return Err(CoreError::VersionNotApproved {
                        version: version.clone(),
                    });
                }
            }
            let pinned: HashSet<&VersionId> = baseline.entries().iter().map(|(_, v)| v).collect();
            for (_, version) in baseline.entries() {
                let version_ref = store.versions.get(version).expect("validada arriba");
                for source in version_ref.sources() {
                    if !pinned.contains(source) {
                        return Err(CoreError::BaselineMissingSource {
                            version: version.clone(),
                            source: source.clone(),
                        });
                    }
                }
            }
            store.baselines.insert(baseline.id().clone(), baseline);
        }
        // Orden de historial = números consecutivos.
        let mut ordered: Vec<&Version> = store.versions.values().collect();
        ordered.sort_by(|a, b| {
            a.artifact()
                .as_str()
                .cmp(b.artifact().as_str())
                .then(a.number().cmp(&b.number()))
        });
        for version in ordered {
            store
                .by_artifact
                .entry(version.artifact().clone())
                .or_default()
                .push(version.id().clone());
        }
        Ok(store)
    }

    /// Todos los proyectos, ordenados por identificador.
    pub fn projects(&self) -> Vec<&Project> {
        let mut all: Vec<&Project> = self.projects.values().collect();
        all.sort_by(|a, b| a.id().as_str().cmp(b.id().as_str()));
        all
    }

    /// Módulos de un proyecto, ordenados por identificador.
    pub fn modules_of(&self, project: &ProjectId) -> Vec<&Module> {
        let mut all: Vec<&Module> = self
            .modules
            .values()
            .filter(|m| m.project() == project)
            .collect();
        all.sort_by(|a, b| a.id().as_str().cmp(b.id().as_str()));
        all
    }

    /// Artefactos de un módulo, ordenados por identificador.
    pub fn artifacts_of(&self, project: &ProjectId, module: &ModuleId) -> Vec<&Artifact> {
        let mut all: Vec<&Artifact> = self
            .artifacts
            .values()
            .filter(|a| a.project() == project && a.module() == module)
            .collect();
        all.sort_by(|a, b| a.id().as_str().cmp(b.id().as_str()));
        all
    }

    /// Versiones de un artefacto en orden de creación (la actual es la última).
    pub fn versions_of(&self, artifact: &ArtifactId) -> Vec<&Version> {
        self.by_artifact
            .get(artifact)
            .map(|ids| ids.iter().filter_map(|id| self.versions.get(id)).collect())
            .unwrap_or_default()
    }

    pub fn current_version(&self, artifact: &ArtifactId) -> Option<&Version> {
        self.versions_of(artifact).pop()
    }

    pub fn approvals_of(&self, version: &VersionId) -> Vec<&Approval> {
        self.approvals
            .iter()
            .filter(|a| a.version() == version)
            .collect()
    }

    /// Todas las aprobaciones en orden de registro.
    pub fn approvals(&self) -> Vec<&Approval> {
        self.approvals.iter().collect()
    }

    pub fn is_approved(&self, version: &VersionId) -> bool {
        self.approvals.iter().any(|a| a.version() == version)
    }

    /// Vigencia calculada de una versión a partir de sus fuentes exactas.
    pub fn validity(&self, version: &VersionId) -> Result<Validity, CoreError> {
        let Some(version_ref) = self.versions.get(version) else {
            return Err(CoreError::VersionNotFound {
                version: version.clone(),
            });
        };
        let Some(artifact) = self.artifacts.get(version_ref.artifact()) else {
            return Err(CoreError::ArtifactNotFound {
                artifact: version_ref.artifact().clone(),
            });
        };
        let views = self.project_views(artifact.project());
        let view = views
            .iter()
            .find(|v| &v.id == version)
            .expect("la versión está en su proyecto");
        Ok(Validity::of(view, &views))
    }

    /// Artefactos del proyecto cuya versión actual no está vigente y por tanto
    /// requieren revisión.
    pub fn requires_review(&self, project: &ProjectId) -> Result<Vec<ArtifactId>, CoreError> {
        if !self.projects.contains_key(project) {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        }
        let views = self.project_views(project);
        let mut stale: Vec<ArtifactId> = views
            .iter()
            .filter(|v| v.is_current && !version_is_valid(v, &views))
            .map(|v| v.artifact.clone())
            .collect();
        stale.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        Ok(stale)
    }

    /// Informe de impacto transitivo desde unos artefactos cambiados, con los
    /// caminos que justifican cada impacto. No modifica nada.
    pub fn impact(
        &self,
        project: &ProjectId,
        changed: &[ArtifactId],
    ) -> Result<ImpactReport, CoreError> {
        if !self.projects.contains_key(project) {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        }
        for artifact in changed {
            self.artifact_in_project(project, artifact)?;
        }
        Ok(compute_impact(changed, &self.project_views(project)))
    }

    // -- Ayudas internas --

    fn artifact_in_project(
        &self,
        project: &ProjectId,
        artifact: &ArtifactId,
    ) -> Result<&Artifact, CoreError> {
        if !self.projects.contains_key(project) {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        }
        let Some(artifact_ref) = self.artifacts.get(artifact) else {
            return Err(CoreError::ArtifactNotFound {
                artifact: artifact.clone(),
            });
        };
        if artifact_ref.project() != project {
            return Err(CoreError::ArtifactNotInProject {
                artifact: artifact.clone(),
                project: project.clone(),
            });
        }
        Ok(artifact_ref)
    }

    fn current_id(&self, artifact: &ArtifactId) -> Option<VersionId> {
        self.by_artifact
            .get(artifact)
            .and_then(|ids| ids.last().cloned())
    }

    fn project_views(&self, project: &ProjectId) -> Vec<VersionView> {
        let mut views = Vec::new();
        for (artifact_id, ids) in &self.by_artifact {
            let Some(artifact) = self.artifacts.get(artifact_id) else {
                continue;
            };
            if artifact.project() != project {
                continue;
            }
            for (index, id) in ids.iter().enumerate() {
                let Some(version) = self.versions.get(id) else {
                    continue;
                };
                views.push(VersionView {
                    id: id.clone(),
                    artifact: artifact_id.clone(),
                    sources: version.sources().to_vec(),
                    is_current: index + 1 == ids.len(),
                });
            }
        }
        views
    }
}
