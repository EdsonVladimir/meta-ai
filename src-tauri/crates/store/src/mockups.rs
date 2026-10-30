//! Screen-generation log and its proposals.
//!
//! Mirrors `proposals` and `design`: each generation keeps identity,
//! project and module, model, exact context versions, template version,
//! usage and questions; each proposal (ONE PER SCREEN, at most three),
//! its title, the canonical JSON of a single-screen mockup,
//! the explanation and the state (pending, accepted with artifact and
//! final content, or discarded).
//!
//! Staleness is computed in `ruth-api`, not stored. No keys, headers or
//! raw responses are saved.

use crate::error::StoreError;
use crate::proposals::ProposalState;

/// Validated screen proposal, with its acceptance state.
/// `spec_json` is the canonical JSON of a ONE-screen mockup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMockupProposal {
    pub temp_id: String,
    pub title: String,
    pub spec_json: String,
    pub explanation: String,
    pub state: ProposalState,
}

/// Registered screen generation, linked to its original context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMockupGeneration {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub model: String,
    pub context_version_ids: Vec<String>,
    pub template_version: u32,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
    pub questions: Vec<String>,
    pub proposals: Vec<StoredMockupProposal>,
}

/// In-memory log, mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MockupLog {
    generations: Vec<StoredMockupGeneration>,
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

impl MockupLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a generation (newly validated or rehydrated). Requires
    /// a unique identity, at least one proposal with content and unique
    /// temp identifiers.
    pub fn record(&mut self, generation: StoredMockupGeneration) -> Result<(), StoreError> {
        if generation.id.trim().is_empty() {
            return Err(invalid("the screen generation has no identity"));
        }
        if self.generations.iter().any(|g| g.id == generation.id) {
            return Err(invalid(format!(
                "duplicate screen generation: {}",
                generation.id
            )));
        }
        if generation.proposals.is_empty() {
            return Err(invalid("the screen generation brings no proposals"));
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
            if proposal.title.trim().is_empty() || proposal.spec_json.trim().is_empty() {
                return Err(invalid("the screen proposal brings no content"));
            }
        }
        self.generations.push(generation);
        Ok(())
    }

    /// All generations, in registration order. Read-only.
    pub fn all(&self) -> &[StoredMockupGeneration] {
        &self.generations
    }

    pub fn generation(&self, id: &str) -> Option<&StoredMockupGeneration> {
        self.generations.iter().find(|g| g.id == id)
    }

    fn generation_mut(&mut self, id: &str) -> Result<&mut StoredMockupGeneration, StoreError> {
        self.generations
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| invalid(format!("unknown screen generation: {id}")))
    }

    /// A module screen generations, in registration order.
    pub fn generations_of(&self, module_id: &str) -> Vec<&StoredMockupGeneration> {
        self.generations
            .iter()
            .filter(|g| g.module_id == module_id)
            .collect()
    }

    fn proposal_mut(
        &mut self,
        generation_id: &str,
        temp_id: &str,
    ) -> Result<&mut StoredMockupProposal, StoreError> {
        let generation = self.generation_mut(generation_id)?;
        generation
            .proposals
            .iter_mut()
            .find(|p| p.temp_id == temp_id)
            .ok_or_else(|| invalid(format!("unknown screen: {temp_id}")))
    }

    /// Marks a screen accepted. Only from pending; if already accepted
    /// with the same artifact it is idempotent.
    pub fn mark_accepted(
        &mut self,
        generation_id: &str,
        temp_id: &str,
        artifact_id: &str,
        content: &str,
    ) -> Result<(), StoreError> {
        let proposal = self.proposal_mut(generation_id, temp_id)?;
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
                "screen {temp_id} was already accepted with another artifact"
            ))),
            ProposalState::Discarded => Err(invalid(format!(
                "screen {temp_id} is discarded and cannot be accepted"
            ))),
        }
    }

    /// Marks a screen discarded. Idempotent.
    pub fn mark_discarded(&mut self, generation_id: &str, temp_id: &str) -> Result<(), StoreError> {
        let proposal = self.proposal_mut(generation_id, temp_id)?;
        match &proposal.state {
            ProposalState::Pending | ProposalState::Discarded => {
                proposal.state = ProposalState::Discarded;
                Ok(())
            }
            ProposalState::Accepted { .. } => Err(invalid(format!(
                "screen {temp_id} was already accepted and cannot be discarded"
            ))),
        }
    }

    /// Was this screen already accepted? (To avoid duplicates.)
    pub fn accepted_artifact(&self, generation_id: &str, temp_id: &str) -> Option<String> {
        let generation = self.generation(generation_id)?;
        generation
            .proposals
            .iter()
            .find(|p| p.temp_id == temp_id)
            .and_then(|proposal| match &proposal.state {
                ProposalState::Accepted { artifact_id, .. } => Some(artifact_id.clone()),
                _ => None,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proposal(temp_id: &str) -> StoredMockupProposal {
        StoredMockupProposal {
            temp_id: temp_id.to_string(),
            title: "Screen".to_string(),
            spec_json: "{\"title\":\"Screen\"}".to_string(),
            explanation: "E".to_string(),
            state: ProposalState::Pending,
        }
    }

    fn generation(id: &str) -> StoredMockupGeneration {
        StoredMockupGeneration {
            id: id.to_string(),
            project_id: "proy-1".to_string(),
            module_id: "mod-2".to_string(),
            model: "muse-spark-1.3".to_string(),
            context_version_ids: vec!["req-3-v1".to_string()],
            template_version: 1,
            input_tokens: Some(10),
            output_tokens: Some(20),
            total_tokens: Some(30),
            created_at: "2026-10-28T12:00:00Z".to_string(),
            questions: vec![],
            proposals: vec![proposal("p1"), proposal("p2")],
        }
    }

    #[test]
    fn records_and_lists_by_module() {
        let mut log = MockupLog::new();
        log.record(generation("gen-1")).expect("records");
        assert_eq!(log.generations_of("mod-2").len(), 1);
        assert!(log.generations_of("mod-9").is_empty());
        assert_eq!(log.generation("gen-1").expect("id").proposals.len(), 2);
    }

    #[test]
    fn rejects_duplicate_ids_and_empty_proposals() {
        let mut log = MockupLog::new();
        log.record(generation("gen-1")).expect("records");
        assert!(log.record(generation("gen-1")).is_err());
        let mut dup = generation("gen-2");
        dup.proposals[1].temp_id = "p1".to_string();
        assert!(log.record(dup).is_err());
        let mut empty = generation("gen-3");
        empty.proposals.clear();
        assert!(log.record(empty).is_err());
    }

    #[test]
    fn accept_is_idempotent_per_screen() {
        let mut log = MockupLog::new();
        log.record(generation("gen-1")).expect("records");
        log.mark_accepted("gen-1", "p1", "mockup-9", "{}")
            .expect("accepts");
        assert_eq!(
            log.accepted_artifact("gen-1", "p1").as_deref(),
            Some("mockup-9")
        );
        assert_eq!(log.accepted_artifact("gen-1", "p2"), None);
        log.mark_accepted("gen-1", "p1", "mockup-9", "{}")
            .expect("idempotent retry");
        assert!(log.mark_accepted("gen-1", "p1", "mockup-10", "{}").is_err());
        assert!(log.mark_discarded("gen-1", "p1").is_err());
        log.mark_discarded("gen-1", "p2").expect("discards");
        assert!(log.mark_accepted("gen-1", "p2", "mockup-11", "{}").is_err());
    }
}
