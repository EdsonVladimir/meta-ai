//! Estado en memoria y casos de uso del núcleo.

use std::collections::{HashMap, HashSet};

use crate::domain::{
    compute_impact, dependency_cycle, duplicate_source, find_cycle, version_is_valid, AgentId,
    Approval, Artifact, ArtifactId, ArtifactType, Author, Baseline, BaselineId, Content, CoreError,
    Date, DeliveryId, HumanId, ImpactReport, Module, ModuleId, Name, Project, ProjectId,
    Provenance, TitleChange, Validity, Version, VersionId, VersionView, WorkDelivery,
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
    pub title_history: Vec<TitleChange>,
    pub deliveries: Vec<WorkDelivery>,
}

/// Referencias de un artefacto dentro del dominio: de qué depende su
/// borrado seguro (dependientes de otros artefactos, baselines y entregas
/// que lo incluyen, y aprobaciones de sus versiones). Orden determinista.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactReferences {
    pub dependents: Vec<ArtifactId>,
    pub baselines: Vec<BaselineId>,
    pub deliveries: Vec<DeliveryId>,
    pub approvals: usize,
    pub versions: usize,
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
    deliveries: HashMap<DeliveryId, WorkDelivery>,
    /// Historial de títulos por artefacto, en orden de registro. Metadato
    /// versionado separado del contenido: no crea versiones ni toca
    /// aprobaciones, vigencia o impacto.
    title_history: Vec<TitleChange>,
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
        if module_ref.archived() {
            return Err(CoreError::ArchivedModule {
                module: module.clone(),
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
        if self.effectively_archived(artifact_ref) {
            return Err(CoreError::ArchivedArtifact {
                artifact: artifact.clone(),
            });
        }
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
        let artifact_ref = self.artifact_in_project(project, artifact)?;
        if self.effectively_archived(artifact_ref) {
            return Err(CoreError::ArchivedArtifact {
                artifact: artifact.clone(),
            });
        }
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
        // Una fuente archivada bloquea antes que la vigencia: restaurar la
        // fuente puede bastar sin crear otra versión.
        if let Some(source) = self.first_archived_source(&current) {
            return Err(CoreError::ArchivedSource {
                version: current.clone(),
                source,
            });
        }
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
            let entry_artifact = self
                .artifacts
                .get(artifact)
                .expect("artefacto validado arriba");
            if self.effectively_archived(entry_artifact) {
                return Err(CoreError::ArchivedArtifact {
                    artifact: artifact.clone(),
                });
            }
            // Las fuentes fijadas tampoco pueden estar archivadas: la entrega
            // debe poder aprobarse y reproducirse con fuentes activas.
            if let Some(source) = self.first_archived_source(version) {
                return Err(CoreError::ArchivedSource {
                    version: version.clone(),
                    source,
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
        // Títulos vigentes fijados con la baseline: la histórica conserva
        // sus nombres originales aunque se renombre después.
        let titles: HashMap<ArtifactId, Option<String>> = entries
            .iter()
            .map(|(artifact, _)| {
                let title = self
                    .artifacts
                    .get(artifact)
                    .expect("artefacto validado arriba")
                    .title()
                    .map(str::to_string);
                (artifact.clone(), title)
            })
            .collect();
        let baseline = Baseline::new(id.clone(), project.clone(), entries.to_vec(), titles, at);
        self.baselines.insert(id, baseline.clone());
        Ok(baseline)
    }

    /// Crea una entrega de trabajo/borrador: foto inmutable de versiones
    /// guardadas SIN exigir aprobación (diseño vivo). Exige proyecto,
    /// entradas no vacías sin duplicar artefacto, versiones existentes que
    /// pertenezcan al artefacto y sean las actuales, y nada archivado
    /// (entradas ni fuentes fijadas). A diferencia de la baseline, NO exige
    /// cierre bajo fuentes: las fuentes de cada entrada se identifican al
    /// leer (incluidas las desactualizadas), sin prohibir la entrega.
    /// Por eso una entrega con pendientes nunca debe llamarse coherente.
    /// No relaja `create_baseline`: son invariantes separadas.
    #[allow(clippy::too_many_arguments)]
    pub fn create_work_delivery(
        &mut self,
        project: &ProjectId,
        id: DeliveryId,
        name: String,
        description: Option<String>,
        scope_module: Option<ModuleId>,
        entries: &[(ArtifactId, VersionId)],
        at: Date,
    ) -> Result<WorkDelivery, CoreError> {
        if !self.projects.contains_key(project) {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        }
        if self.deliveries.contains_key(&id) {
            return Err(CoreError::DuplicateDelivery { delivery: id });
        }
        if entries.is_empty() {
            return Err(CoreError::EmptyDelivery);
        }
        if let Some(scope) = &scope_module {
            self.module_in_project(project, scope)?;
        }
        let mut seen_artifacts = HashSet::new();
        for (artifact, _) in entries {
            if !seen_artifacts.insert(artifact) {
                return Err(CoreError::DeliveryDuplicateArtifact {
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
                return Err(CoreError::DeliveryMismatch {
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
            let entry_artifact = self
                .artifacts
                .get(artifact)
                .expect("artefacto validado arriba");
            if self.effectively_archived(entry_artifact) {
                return Err(CoreError::ArchivedArtifact {
                    artifact: artifact.clone(),
                });
            }
            if let Some(source) = self.first_archived_source(version) {
                return Err(CoreError::ArchivedSource {
                    version: version.clone(),
                    source,
                });
            }
        }
        // Sin cierre bajo fuentes (ver el doc): las fuentes se listan al
        // leer y las desactualizadas se señalan, sin bloquear la entrega.
        let titles: HashMap<ArtifactId, Option<String>> = entries
            .iter()
            .map(|(artifact, _)| {
                let title = self
                    .artifacts
                    .get(artifact)
                    .expect("artefacto validado arriba")
                    .title()
                    .map(str::to_string);
                (artifact.clone(), title)
            })
            .collect();
        let delivery = WorkDelivery::new(
            id.clone(),
            project.clone(),
            name,
            description,
            scope_module,
            entries.to_vec(),
            titles,
            at,
        );
        self.deliveries.insert(id, delivery.clone());
        Ok(delivery)
    }

    /// Archiva o restaura un módulo. El contenido se oculta por contexto sin
    /// cambiar el estado individual de cada artefacto: restaurar el módulo no
    /// restaura lo archivado individualmente. Siempre permitido: archivar no
    /// rompe dependencias (sus consecuencias aparecen al aprobar o entregar).
    pub fn set_module_archived(
        &mut self,
        project: &ProjectId,
        module: &ModuleId,
        archived: bool,
    ) -> Result<Module, CoreError> {
        self.module_in_project(project, module)?;
        let module_ref = self.modules.get_mut(module).expect("validado arriba");
        module_ref.set_archived(archived);
        Ok(module_ref.clone())
    }

    /// Archiva o restaura un artefacto individualmente. Siempre permitido;
    /// conserva versiones, aprobaciones, dependencias y baselines.
    pub fn set_artifact_archived(
        &mut self,
        project: &ProjectId,
        artifact: &ArtifactId,
        archived: bool,
    ) -> Result<Artifact, CoreError> {
        self.artifact_in_project(project, artifact)?;
        let artifact_ref = self.artifacts.get_mut(artifact).expect("validado arriba");
        artifact_ref.set_archived(archived);
        Ok(artifact_ref.clone())
    }

    /// Elimina un artefacto con sus versiones. Solo cuando es seguro: sin
    /// aprobaciones, sin dependientes de otros artefactos y sin presencia en
    /// baselines. Sin cascadas: si algo lo referencia, se rechaza indicando
    /// qué; archivar es la alternativa.
    pub fn delete_artifact(
        &mut self,
        project: &ProjectId,
        artifact: &ArtifactId,
    ) -> Result<ArtifactId, CoreError> {
        self.artifact_in_project(project, artifact)?;
        let refs = self.artifact_references(project, artifact)?;
        if refs.approvals > 0 {
            return Err(CoreError::DeleteHasApprovals {
                artifact: artifact.clone(),
            });
        }
        if !refs.dependents.is_empty() {
            return Err(CoreError::DeleteHasDependents {
                artifact: artifact.clone(),
                dependents: refs.dependents,
            });
        }
        if let Some(baseline) = refs.baselines.first() {
            return Err(CoreError::DeleteInBaseline {
                artifact: artifact.clone(),
                baseline: baseline.clone(),
            });
        }
        if let Some(delivery) = refs.deliveries.first() {
            return Err(CoreError::DeleteInDelivery {
                artifact: artifact.clone(),
                delivery: delivery.clone(),
            });
        }
        if let Some(ids) = self.by_artifact.remove(artifact) {
            for id in ids {
                self.versions.remove(&id);
            }
        }
        self.title_history
            .retain(|change| change.artifact() != artifact);
        self.artifacts.remove(artifact);
        Ok(artifact.clone())
    }

    /// Renombra un proyecto. Solo cambia el nombre organizativo: la
    /// identidad y todo lo que cuelga de ella quedan intactos. Exige el
    /// nombre esperado para no sobrescribir un cambio concurrente.
    pub fn rename_project(
        &mut self,
        project: &ProjectId,
        expected: &str,
        name: Name,
    ) -> Result<Project, CoreError> {
        let Some(known) = self.projects.get(project) else {
            return Err(CoreError::ProjectNotFound {
                project: project.clone(),
            });
        };
        if known.name() != expected {
            return Err(CoreError::StaleName {
                expected: Some(expected.to_string()),
                actual: Some(known.name().to_string()),
            });
        }
        let project_ref = self.projects.get_mut(project).expect("validado arriba");
        project_ref.set_name(name);
        Ok(project_ref.clone())
    }

    /// Renombra un módulo. Como en proyectos, más la pertenencia y el
    /// bloqueo sobre módulos archivados (restaurar primero).
    pub fn rename_module(
        &mut self,
        project: &ProjectId,
        module: &ModuleId,
        expected: &str,
        name: Name,
    ) -> Result<Module, CoreError> {
        let known = self.module_in_project(project, module)?;
        if known.archived() {
            return Err(CoreError::ArchivedModule {
                module: module.clone(),
            });
        }
        if known.name() != expected {
            return Err(CoreError::StaleName {
                expected: Some(expected.to_string()),
                actual: Some(known.name().to_string()),
            });
        }
        let module_ref = self.modules.get_mut(module).expect("validado arriba");
        module_ref.set_name(name);
        Ok(module_ref.clone())
    }

    /// Cambia el título de un requisito o diagrama y lo registra en el
    /// historial. Metadato separado del contenido: no crea versiones, no
    /// toca fuentes ni aprobaciones y no genera impacto. Bloqueado sobre
    /// archivados efectivos; exige el título esperado (`None` = sin título).
    pub fn rename_artifact(
        &mut self,
        project: &ProjectId,
        artifact: &ArtifactId,
        expected: Option<&str>,
        title: Name,
        by: &HumanId,
        at: Date,
    ) -> Result<Artifact, CoreError> {
        let known = self.artifact_in_project(project, artifact)?;
        if self.effectively_archived(known) {
            return Err(CoreError::ArchivedArtifact {
                artifact: artifact.clone(),
            });
        }
        if known.title() != expected {
            return Err(CoreError::StaleName {
                expected: expected.map(str::to_string),
                actual: known.title().map(str::to_string),
            });
        }
        let artifact_ref = self.artifacts.get_mut(artifact).expect("validado arriba");
        artifact_ref.set_title(Some(title.clone()));
        self.title_history
            .push(TitleChange::new(artifact.clone(), title, by.clone(), at));
        Ok(artifact_ref.clone())
    }

    /// Elimina un módulo vacío. Con contenido (activo o archivado) se rechaza:
    /// hay que vaciarlo primero, artefacto a artefacto.
    pub fn delete_module(
        &mut self,
        project: &ProjectId,
        module: &ModuleId,
    ) -> Result<ModuleId, CoreError> {
        self.module_in_project(project, module)?;
        let contents: Vec<ArtifactId> = self
            .artifacts_of(project, module)
            .iter()
            .map(|a| (*a).id().clone())
            .collect();
        if !contents.is_empty() {
            return Err(CoreError::DeleteModuleNotEmpty {
                module: module.clone(),
                artifacts: contents,
            });
        }
        self.modules.remove(module);
        Ok(module.clone())
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

    pub fn delivery(&self, id: &DeliveryId) -> Option<&WorkDelivery> {
        self.deliveries.get(id)
    }

    /// Todas las entregas de trabajo, ordenadas por identificador.
    pub fn deliveries(&self) -> Vec<&WorkDelivery> {
        let mut all: Vec<&WorkDelivery> = self.deliveries.values().collect();
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
        for change in snapshot.title_history {
            if !store.artifacts.contains_key(change.artifact()) {
                return Err(CoreError::ArtifactNotFound {
                    artifact: change.artifact().clone(),
                });
            }
            store.title_history.push(change);
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
        // Entregas de trabajo: estructurales, sin exigir aprobación (igual
        // que al crearlas). Las baselines históricas conservan su propia
        // validación de arriba, sin relajar.
        for delivery in snapshot.deliveries {
            if store.deliveries.contains_key(delivery.id()) {
                return Err(CoreError::DuplicateDelivery {
                    delivery: delivery.id().clone(),
                });
            }
            if !store.projects.contains_key(delivery.project()) {
                return Err(CoreError::ProjectNotFound {
                    project: delivery.project().clone(),
                });
            }
            if let Some(scope) = delivery.scope_module() {
                if !store.modules.contains_key(scope) {
                    return Err(CoreError::ModuleNotFound {
                        module: scope.clone(),
                    });
                }
            }
            if delivery.entries().is_empty() {
                return Err(CoreError::EmptyDelivery);
            }
            let mut seen = HashSet::new();
            for (artifact, _) in delivery.entries() {
                if !seen.insert(artifact) {
                    return Err(CoreError::DeliveryDuplicateArtifact {
                        artifact: artifact.clone(),
                    });
                }
            }
            for (artifact, version) in delivery.entries() {
                let Some(artifact_ref) = store.artifacts.get(artifact) else {
                    return Err(CoreError::ArtifactNotFound {
                        artifact: artifact.clone(),
                    });
                };
                if artifact_ref.project() != delivery.project() {
                    return Err(CoreError::ArtifactNotInProject {
                        artifact: artifact.clone(),
                        project: delivery.project().clone(),
                    });
                }
                let Some(version_ref) = store.versions.get(version) else {
                    return Err(CoreError::VersionNotFound {
                        version: version.clone(),
                    });
                };
                if version_ref.artifact() != artifact {
                    return Err(CoreError::DeliveryMismatch {
                        artifact: artifact.clone(),
                        version: version.clone(),
                    });
                }
            }
            store.deliveries.insert(delivery.id().clone(), delivery);
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

    /// Todo el historial de títulos, en orden de registro. Lo usan la
    /// persistencia y las instantáneas; para un artefacto, `title_history`.
    pub fn title_changes(&self) -> &[TitleChange] {
        &self.title_history
    }

    /// Historial de títulos de un artefacto, en orden de registro. Vacío
    /// cuando nunca se tituló. No muta.
    pub fn title_history(&self, artifact: &ArtifactId) -> Vec<&TitleChange> {
        self.title_history
            .iter()
            .filter(|change| change.artifact() == artifact)
            .collect()
    }

    /// ¿Está el artefacto archivado, por sí mismo o por su módulo? Se calcula
    /// en cada consulta: ningún flag redundante puede contradecirlo.
    pub fn is_effectively_archived(&self, artifact: &ArtifactId) -> bool {
        self.artifacts
            .get(artifact)
            .map(|a| self.effectively_archived(a))
            .unwrap_or(false)
    }

    /// Referencias de un artefacto para decidir archivado y borrado. No muta.
    pub fn artifact_references(
        &self,
        project: &ProjectId,
        artifact: &ArtifactId,
    ) -> Result<ArtifactReferences, CoreError> {
        self.artifact_in_project(project, artifact)?;
        let own: HashSet<&VersionId> = self
            .by_artifact
            .get(artifact)
            .map(|ids| ids.iter().collect())
            .unwrap_or_default();
        let mut dependents = HashSet::new();
        for version in self.versions.values() {
            if version.artifact() == artifact {
                continue;
            }
            if version.sources().iter().any(|s| own.contains(s)) {
                dependents.insert(version.artifact().clone());
            }
        }
        let mut dependents: Vec<ArtifactId> = dependents.into_iter().collect();
        dependents.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        let mut baselines: Vec<BaselineId> = self
            .baselines
            .values()
            .filter(|b| b.project() == project && b.entries().iter().any(|(a, _)| a == artifact))
            .map(|b| b.id().clone())
            .collect();
        baselines.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        let mut deliveries: Vec<DeliveryId> = self
            .deliveries
            .values()
            .filter(|d| d.project() == project && d.entries().iter().any(|(a, _)| a == artifact))
            .map(|d| d.id().clone())
            .collect();
        deliveries.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        let approvals = self
            .by_artifact
            .get(artifact)
            .map(|ids| ids.iter().map(|id| self.approvals_of(id).len()).sum())
            .unwrap_or(0);
        Ok(ArtifactReferences {
            dependents,
            baselines,
            deliveries,
            approvals,
            versions: own.len(),
        })
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

    fn effectively_archived(&self, artifact: &Artifact) -> bool {
        if artifact.archived() {
            return true;
        }
        self.modules
            .get(artifact.module())
            .map(|m| m.archived())
            .unwrap_or(false)
    }

    /// Primera fuente efectivamente archivada de una versión, si la hay.
    fn first_archived_source(&self, version: &VersionId) -> Option<VersionId> {
        let version_ref = self.versions.get(version)?;
        for source in version_ref.sources() {
            let Some(source_ref) = self.versions.get(source) else {
                continue;
            };
            let Some(source_artifact) = self.artifacts.get(source_ref.artifact()) else {
                continue;
            };
            if self.effectively_archived(source_artifact) {
                return Some(source.clone());
            }
        }
        None
    }

    fn module_in_project(
        &self,
        project: &ProjectId,
        module: &ModuleId,
    ) -> Result<&Module, CoreError> {
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
        Ok(module_ref)
    }

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
