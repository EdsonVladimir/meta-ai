//! Assisted-generation log and its proposals (milestone 5).
//!
//! Pure persistence data, no domain rules: each generation keeps its
//! identity, project and module, model, sent description, exact versions
//! used as context, template version, usage state and questions; each
//! proposal, its validated content and its state (pending, accepted with
//! artifact and final content, or discarded).
//!
//! The only state machine here is the proposal transition (pending to
//! accepted or discarded). Staleness (did a source change since the
//! generation?) is computed in `ruth-api` by comparing against the `Store`,
//! not stored. No keys, headers or raw responses are saved.

use crate::error::StoreError;

/// A proposal state. Accepting records the final artifact created
/// and the finally accepted content (may include human edits).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposalState {
    Pending,
    Accepted {
        artifact_id: String,
        content: String,
    },
    Discarded,
}

/// A generation validated proposal, with its acceptance state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredProposal {
    pub temp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
    pub state: ProposalState,
}

/// Registered generation, linked to its exact original context.
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

/// In-memory log, mirror of the last confirmed commit.
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

    /// Records a generation (newly validated or rehydrated on open).
    /// Requires a unique identity, at least one proposal and unique temp
    /// identifiers. That new ones arrive pending is enforced by
    /// persistence (`save_generation`), not by this log.
    pub fn record(&mut self, generation: StoredGeneration) -> Result<(), StoreError> {
        if generation.id.trim().is_empty() {
            return Err(invalid("the generation has no identity"));
        }
        if self.generations.iter().any(|g| g.id == generation.id) {
            return Err(invalid(format!("duplicate generation: {}", generation.id)));
        }
        if generation.proposals.is_empty() {
            return Err(invalid("the generation brings no proposals"));
        }
        let mut seen = std::collections::HashSet::new();
        for proposal in &generation.proposals {
            if proposal.temp_id.trim().is_empty() {
                return Err(invalid("proposal without a temp identifier"));
            }
            if !seen.insert(proposal.temp_id.clone()) {
                return Err(invalid(format!(
                    "duplicate temp identifier: {}",
                    proposal.temp_id
                )));
            }
        }
        self.generations.push(generation);
        Ok(())
    }

    /// All generations, in registration order. Read-only.
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
            .ok_or_else(|| invalid(format!("unknown generation: {id}")))
    }

    /// A module generations, in registration order.
    pub fn generations_of(&self, module_id: &str) -> Vec<&StoredGeneration> {
        self.generations
            .iter()
            .filter(|g| g.module_id == module_id)
            .collect()
    }

    /// Marks a proposal accepted. Only from pending; if already accepted
    /// with the same artifact it is idempotent (safe retry).
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
            .ok_or_else(|| invalid(format!("unknown proposal: {temp_id}")))?;
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
                "proposal {temp_id} was already accepted with another artifact"
            ))),
            ProposalState::Discarded => Err(invalid(format!(
                "proposal {temp_id} is discarded and cannot be accepted"
            ))),
        }
    }

    /// Marks a proposal discarded. Idempotent.
    pub fn mark_discarded(&mut self, generation_id: &str, temp_id: &str) -> Result<(), StoreError> {
        let generation = self.generation_mut(generation_id)?;
        let proposal = generation
            .proposals
            .iter_mut()
            .find(|p| p.temp_id == temp_id)
            .ok_or_else(|| invalid(format!("unknown proposal: {temp_id}")))?;
        match &proposal.state {
            ProposalState::Pending | ProposalState::Discarded => {
                proposal.state = ProposalState::Discarded;
                Ok(())
            }
            ProposalState::Accepted { .. } => Err(invalid(format!(
                "proposal {temp_id} was already accepted and cannot be discarded"
            ))),
        }
    }

    /// Was this proposal already accepted? (To avoid duplicates on retry.)
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
            questions: vec!["Do they expire?".to_string()],
            proposals: vec![pending("p1"), pending("p2")],
        }
    }

    #[test]
    fn records_and_lists_by_module() {
        let mut log = ProposalLog::new();
        log.record(generation("gen-1")).expect("records");
        assert_eq!(log.generations_of("mod-2").len(), 1);
        assert!(log.generations_of("mod-9").is_empty());
        assert_eq!(log.generation("gen-1").expect("id").questions.len(), 1);
    }

    #[test]
    fn rejects_duplicate_ids_and_empty_proposals() {
        let mut log = ProposalLog::new();
        log.record(generation("gen-1")).expect("records");
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
        log.record(generation("gen-1")).expect("records");
        log.mark_accepted("gen-1", "p1", "req-9", "content")
            .expect("accepts");
        assert_eq!(
            log.accepted_artifact("gen-1", "p1").as_deref(),
            Some("req-9")
        );
        log.mark_accepted("gen-1", "p1", "req-9", "content")
            .expect("idempotent retry");
        assert!(log.mark_accepted("gen-1", "p1", "req-10", "otro").is_err());
        assert!(log.mark_discarded("gen-1", "p1").is_err());
        log.mark_discarded("gen-1", "p2").expect("discards");
        log.mark_discarded("gen-1", "p2").expect("idempotent retry");
        assert!(log.mark_accepted("gen-1", "p2", "req-11", "x").is_err());
    }
}
