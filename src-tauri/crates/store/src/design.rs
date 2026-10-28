//! Registro de generaciones de diseño y su propuesta (hito 6).
//!
//! Espeja `proposals`: cada generación de flujo o ER conserva identidad,
//! proyecto y módulo, tipo, modelo, versiones exactas de contexto, versión de
//! plantilla, uso y preguntas; su propuesta (UNA por generación), el título,
//! la especificación JSON canónica, la explicación y el estado (pendiente,
//! aceptada con artefacto y contenido final, o descartada).
//!
//! La caducidad se calcula en `ruth-api`, no se almacena. No se guardan
//! claves, cabeceras ni respuestas crudas. Mermaid nunca se almacena: se
//! deriva del JSON autoritativo.

use crate::error::StoreError;
use crate::proposals::ProposalState;

/// Propuesta de diseño validada, con su estado de aceptación. `spec_json` es
/// el JSON canónico (`kind`, nodos/entidades, explicación, preguntas).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDesignProposal {
    pub title: String,
    pub spec_json: String,
    pub explanation: String,
    pub state: ProposalState,
}

/// Generación de diseño registrada, vinculada a su contexto original exacto.
/// `kind` es `"flow"` o `"data_model"`. Las propuestas de actualización
/// (hito 8) fijan además el artefacto objetivo y su versión en el momento
/// del snapshot; las de creación dejan ambos a nulo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDesignGeneration {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub kind: String,
    pub model: String,
    pub context_version_ids: Vec<String>,
    pub template_version: u32,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
    pub questions: Vec<String>,
    pub proposal: StoredDesignProposal,
    pub target_artifact_id: Option<String>,
    pub target_version_id: Option<String>,
}

/// Registro en memoria, espejo del último commit confirmado.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DesignLog {
    generations: Vec<StoredDesignGeneration>,
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

impl DesignLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra una generación de diseño (recién validada o rehidratada).
    /// Exige identidad única, tipo conocido y propuesta con contenido.
    pub fn record(&mut self, generation: StoredDesignGeneration) -> Result<(), StoreError> {
        if generation.id.trim().is_empty() {
            return Err(invalid("la generación de diseño no tiene identidad"));
        }
        if self.generations.iter().any(|g| g.id == generation.id) {
            return Err(invalid(format!(
                "generación de diseño duplicada: {}",
                generation.id
            )));
        }
        if generation.kind != "flow" && generation.kind != "data_model" {
            return Err(invalid(format!(
                "tipo de diseño desconocido: {}",
                generation.kind
            )));
        }
        if generation.proposal.title.trim().is_empty()
            || generation.proposal.spec_json.trim().is_empty()
        {
            return Err(invalid("la propuesta de diseño no trae contenido"));
        }
        match (
            generation.target_artifact_id.as_deref(),
            generation.target_version_id.as_deref(),
        ) {
            (None, None) => {}
            (Some(artifact), Some(version))
                if !artifact.trim().is_empty() && !version.trim().is_empty() => {}
            _ => {
                return Err(invalid(
                    "la propuesta de actualización no fija objetivo y versión",
                ));
            }
        }
        self.generations.push(generation);
        Ok(())
    }

    /// Todas las generaciones, en orden de registro. Solo lectura.
    pub fn all(&self) -> &[StoredDesignGeneration] {
        &self.generations
    }

    pub fn design(&self, id: &str) -> Option<&StoredDesignGeneration> {
        self.generations.iter().find(|g| g.id == id)
    }

    fn design_mut(&mut self, id: &str) -> Result<&mut StoredDesignGeneration, StoreError> {
        self.generations
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| invalid(format!("generación de diseño desconocida: {id}")))
    }

    /// Generaciones de diseño de un módulo, en orden de registro.
    pub fn designs_of(&self, module_id: &str) -> Vec<&StoredDesignGeneration> {
        self.generations
            .iter()
            .filter(|g| g.module_id == module_id)
            .collect()
    }

    /// Marca la propuesta como aceptada. Solo desde pendiente; si ya estaba
    /// aceptada con el mismo artefacto es idempotente (reintento seguro).
    pub fn mark_accepted(
        &mut self,
        generation_id: &str,
        artifact_id: &str,
        content: &str,
    ) -> Result<(), StoreError> {
        let proposal = &mut self.design_mut(generation_id)?.proposal;
        match &proposal.state {
            ProposalState::Pending => {
                proposal.state = ProposalState::Accepted {
                    artifact_id: artifact_id.to_string(),
                    content: content.to_string(),
                };
                Ok(())
            }
            ProposalState::Accepted {
                artifact_id: known, ..
            } if known == artifact_id => Ok(()),
            ProposalState::Accepted { .. } => Err(invalid(format!(
                "la propuesta de {generation_id} ya se aceptó con otro artefacto"
            ))),
            ProposalState::Discarded => Err(invalid(format!(
                "la propuesta de {generation_id} está descartada y no puede aceptarse"
            ))),
        }
    }

    /// Marca la propuesta como descartada. Idempotente.
    pub fn mark_discarded(&mut self, generation_id: &str) -> Result<(), StoreError> {
        let proposal = &mut self.design_mut(generation_id)?.proposal;
        match &proposal.state {
            ProposalState::Pending | ProposalState::Discarded => {
                proposal.state = ProposalState::Discarded;
                Ok(())
            }
            ProposalState::Accepted { .. } => Err(invalid(format!(
                "la propuesta de {generation_id} ya se aceptó y no puede descartarse"
            ))),
        }
    }

    /// ¿Ya se aceptó esta propuesta? (Para no crear duplicados al reintentar.)
    pub fn accepted_artifact(&self, generation_id: &str) -> Option<String> {
        let generation = self.design(generation_id)?;
        match &generation.proposal.state {
            ProposalState::Accepted { artifact_id, .. } => Some(artifact_id.clone()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generation(id: &str) -> StoredDesignGeneration {
        StoredDesignGeneration {
            id: id.to_string(),
            project_id: "proy-1".to_string(),
            module_id: "mod-2".to_string(),
            kind: "flow".to_string(),
            model: "muse-spark-1.3".to_string(),
            context_version_ids: vec!["req-3-v1".to_string()],
            template_version: 1,
            input_tokens: Some(10),
            output_tokens: Some(20),
            total_tokens: Some(30),
            created_at: "2026-10-28T12:00:00Z".to_string(),
            questions: vec![],
            proposal: StoredDesignProposal {
                title: "Flujo".to_string(),
                spec_json: "{\"title\":\"Flujo\"}".to_string(),
                explanation: "E".to_string(),
                state: ProposalState::Pending,
            },
            target_artifact_id: None,
            target_version_id: None,
        }
    }

    #[test]
    fn records_and_lists_by_module() {
        let mut log = DesignLog::new();
        log.record(generation("gen-1")).expect("registra");
        assert_eq!(log.designs_of("mod-2").len(), 1);
        assert!(log.designs_of("mod-9").is_empty());
        assert_eq!(log.design("gen-1").expect("id").kind, "flow");
    }

    #[test]
    fn rejects_duplicate_ids_unknown_kind_and_empty_proposal() {
        let mut log = DesignLog::new();
        log.record(generation("gen-1")).expect("registra");
        assert!(log.record(generation("gen-1")).is_err());
        let mut bad = generation("gen-2");
        bad.kind = "uml".to_string();
        assert!(log.record(bad).is_err());
        let mut empty = generation("gen-3");
        empty.proposal.spec_json = "  ".to_string();
        assert!(log.record(empty).is_err());
    }

    #[test]
    fn update_target_needs_both_artifact_and_version() {
        let mut log = DesignLog::new();
        let mut half = generation("gen-9");
        half.target_artifact_id = Some("flujo-4".to_string());
        assert!(log.record(half).is_err());
        let mut full = generation("gen-9");
        full.target_artifact_id = Some("flujo-4".to_string());
        full.target_version_id = Some("flujo-4-v1".to_string());
        log.record(full).expect("objetivo completo");
        assert_eq!(
            log.design("gen-9")
                .expect("id")
                .target_version_id
                .as_deref(),
            Some("flujo-4-v1")
        );
    }

    #[test]
    fn accept_is_idempotent_but_discard_after_accept_fails() {
        let mut log = DesignLog::new();
        log.record(generation("gen-1")).expect("registra");
        log.mark_accepted("gen-1", "flujo-9", "{}").expect("acepta");
        assert_eq!(log.accepted_artifact("gen-1").as_deref(), Some("flujo-9"));
        log.mark_accepted("gen-1", "flujo-9", "{}")
            .expect("reintento idempotente");
        assert!(log.mark_accepted("gen-1", "flujo-10", "{}").is_err());
        assert!(log.mark_discarded("gen-1").is_err());
        assert!(log.mark_discarded("gen-9").is_err());
    }
}
