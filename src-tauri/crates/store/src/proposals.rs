//! Registro de generaciones asistidas y sus propuestas (hito 5).
//!
//! Datos puros de persistencia, sin reglas del dominio: cada generación
//! conserva su identidad, proyecto y módulo, modelo, descripción enviada,
//! versiones exactas usadas como contexto, versión de la plantilla, estado de
//! uso y preguntas; cada propuesta, su contenido validado y su estado
//! (pendiente, aceptada con artefacto y contenido final, o descartada).
//!
//! La única máquina de estados aquí es la transición de propuestas
//! (pendiente → aceptada | descartada). La caducidad (¿cambió una fuente
//! desde la generación?) se calcula en `ruth-api` comparando con el `Store`,
//! no se almacena. No se guardan claves, cabeceras ni respuestas crudas.

use crate::error::StoreError;

/// Estado de una propuesta. Aceptar registra el artefacto definitivo creado
/// y el contenido finalmente aceptado (puede incluir ediciones humanas).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposalState {
    Pending,
    Accepted {
        artifact_id: String,
        content: String,
    },
    Discarded,
}

/// Propuesta validada de una generación, con su estado de aceptación.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredProposal {
    pub temp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
    pub state: ProposalState,
}

/// Generación registrada, vinculada a su contexto original exacto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredGeneration {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub model: String,
    pub description: String,
    pub context_version_ids: Vec<String>,
    pub template_version: u32,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
    pub questions: Vec<String>,
    pub proposals: Vec<StoredProposal>,
}

/// Registro en memoria, espejo del último commit confirmado.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProposalLog {
    generations: Vec<StoredGeneration>,
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

impl ProposalLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra una generación (recién validada o rehidratada al abrir).
    /// Exige identidad única, al menos una propuesta e identificadores
    /// temporales únicos. Que las nuevas lleguen pendientes lo exige la
    /// persistencia (`save_generation`), no este registro.
    pub fn record(&mut self, generation: StoredGeneration) -> Result<(), StoreError> {
        if generation.id.trim().is_empty() {
            return Err(invalid("la generación no tiene identidad"));
        }
        if self.generations.iter().any(|g| g.id == generation.id) {
            return Err(invalid(format!("generación duplicada: {}", generation.id)));
        }
        if generation.proposals.is_empty() {
            return Err(invalid("la generación no trae propuestas"));
        }
        let mut seen = std::collections::HashSet::new();
        for proposal in &generation.proposals {
            if proposal.temp_id.trim().is_empty() {
                return Err(invalid("propuesta sin identificador temporal"));
            }
            if !seen.insert(proposal.temp_id.clone()) {
                return Err(invalid(format!(
                    "identificador temporal duplicado: {}",
                    proposal.temp_id
                )));
            }
        }
        self.generations.push(generation);
        Ok(())
    }

    /// Todas las generaciones, en orden de registro. Solo lectura.
    pub fn all(&self) -> &[StoredGeneration] {
        &self.generations
    }

    pub fn generation(&self, id: &str) -> Option<&StoredGeneration> {
        self.generations.iter().find(|g| g.id == id)
    }

    fn generation_mut(&mut self, id: &str) -> Result<&mut StoredGeneration, StoreError> {
        self.generations
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| invalid(format!("generación desconocida: {id}")))
    }

    /// Generaciones de un módulo, en orden de registro.
    pub fn generations_of(&self, module_id: &str) -> Vec<&StoredGeneration> {
        self.generations
            .iter()
            .filter(|g| g.module_id == module_id)
            .collect()
    }

    /// Marca una propuesta como aceptada. Solo desde pendiente; si ya estaba
    /// aceptada con el mismo artefacto es idempotente (reintento seguro).
    pub fn mark_accepted(
        &mut self,
        generation_id: &str,
        temp_id: &str,
        artifact_id: &str,
        content: &str,
    ) -> Result<(), StoreError> {
        let generation = self.generation_mut(generation_id)?;
        let proposal = generation
            .proposals
            .iter_mut()
            .find(|p| p.temp_id == temp_id)
            .ok_or_else(|| invalid(format!("propuesta desconocida: {temp_id}")))?;
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
                "la propuesta {temp_id} ya se aceptó con otro artefacto"
            ))),
            ProposalState::Discarded => Err(invalid(format!(
                "la propuesta {temp_id} está descartada y no puede aceptarse"
            ))),
        }
    }

    /// Marca una propuesta como descartada. Idempotente.
    pub fn mark_discarded(&mut self, generation_id: &str, temp_id: &str) -> Result<(), StoreError> {
        let generation = self.generation_mut(generation_id)?;
        let proposal = generation
            .proposals
            .iter_mut()
            .find(|p| p.temp_id == temp_id)
            .ok_or_else(|| invalid(format!("propuesta desconocida: {temp_id}")))?;
        match &proposal.state {
            ProposalState::Pending | ProposalState::Discarded => {
                proposal.state = ProposalState::Discarded;
                Ok(())
            }
            ProposalState::Accepted { .. } => Err(invalid(format!(
                "la propuesta {temp_id} ya se aceptó y no puede descartarse"
            ))),
        }
    }

    /// ¿Ya se aceptó esta propuesta? (Para no crear duplicados al reintentar.)
    pub fn accepted_artifact(&self, generation_id: &str, temp_id: &str) -> Option<String> {
        let generation = self.generation(generation_id)?;
        let proposal = generation.proposals.iter().find(|p| p.temp_id == temp_id)?;
        match &proposal.state {
            ProposalState::Accepted { artifact_id, .. } => Some(artifact_id.clone()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(temp_id: &str) -> StoredProposal {
        StoredProposal {
            temp_id: temp_id.to_string(),
            title: "T".to_string(),
            description: "D".to_string(),
            acceptance: vec!["C".to_string()],
            assumptions: vec![],
            state: ProposalState::Pending,
        }
    }

    fn generation(id: &str) -> StoredGeneration {
        StoredGeneration {
            id: id.to_string(),
            project_id: "proy-1".to_string(),
            module_id: "mod-2".to_string(),
            model: "muse-spark-1.3".to_string(),
            description: "Ventas.".to_string(),
            context_version_ids: vec!["req-3-v1".to_string()],
            template_version: 1,
            input_tokens: Some(10),
            output_tokens: Some(20),
            total_tokens: Some(30),
            created_at: "2026-10-27T12:00:00Z".to_string(),
            questions: vec!["¿Caducan?".to_string()],
            proposals: vec![pending("p1"), pending("p2")],
        }
    }

    #[test]
    fn records_and_lists_by_module() {
        let mut log = ProposalLog::new();
        log.record(generation("gen-1")).expect("registra");
        assert_eq!(log.generations_of("mod-2").len(), 1);
        assert!(log.generations_of("mod-9").is_empty());
        assert_eq!(log.generation("gen-1").expect("id").questions.len(), 1);
    }

    #[test]
    fn rejects_duplicate_ids_and_empty_proposals() {
        let mut log = ProposalLog::new();
        log.record(generation("gen-1")).expect("registra");
        assert!(log.record(generation("gen-1")).is_err());
        let mut dup = generation("gen-2");
        dup.proposals.push(pending("p1"));
        assert!(log.record(dup).is_err());
        let mut empty = generation("gen-3");
        empty.proposals.clear();
        assert!(log.record(empty).is_err());
    }

    #[test]
    fn accept_is_idempotent_but_discard_after_accept_fails() {
        let mut log = ProposalLog::new();
        log.record(generation("gen-1")).expect("registra");
        log.mark_accepted("gen-1", "p1", "req-9", "contenido")
            .expect("acepta");
        assert_eq!(
            log.accepted_artifact("gen-1", "p1").as_deref(),
            Some("req-9")
        );
        log.mark_accepted("gen-1", "p1", "req-9", "contenido")
            .expect("reintento idempotente");
        assert!(log.mark_accepted("gen-1", "p1", "req-10", "otro").is_err());
        assert!(log.mark_discarded("gen-1", "p1").is_err());
        log.mark_discarded("gen-1", "p2").expect("descarta");
        log.mark_discarded("gen-1", "p2")
            .expect("reintento idempotente");
        assert!(log.mark_accepted("gen-1", "p2", "req-11", "x").is_err());
    }
}
