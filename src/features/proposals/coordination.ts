// Pure generation-panel coordination: merge Rust snapshots without losing
// local edits, and decide which actions each proposal offers. No React, no
// Tauri: tested with vitest without DOM.
import type { GenerationDto, ProposalDto } from "./types";

/**
 * Inserts or replaces a generation keeping the registration order. Late
 * responses filter out earlier (per module); here only merging happens.
 */
export function upsertGeneration(
  generations: GenerationDto[],
  incoming: GenerationDto,
): GenerationDto[] {
  const index = generations.findIndex((g) => g.id === incoming.id);
  if (index === -1) return [...generations, incoming];
  return generations.map((g, i) => (i === index ? incoming : g));
}

/**
 * Does this proposal take actions? Only when pending, fresh, idle and with
 * an active module: archived items are read, not operated.
 */
export function isActionable(
  proposal: ProposalDto,
  stale: boolean,
  busy: boolean,
  moduleArchived = false,
): boolean {
  return proposal.state === "pending" && !stale && !busy && !moduleArchived;
}

/** Editable card draft: criteria go one per line. */
export interface ProposalEdit {
  title: string;
  description: string;
  acceptance: string;
  assumptions: string;
}

export function editFromProposal(proposal: ProposalDto): ProposalEdit {
  return {
    title: proposal.title,
    description: proposal.description,
    acceptance: proposal.acceptance.join("\n"),
    assumptions: proposal.assumptions.join("\n"),
  };
}

/** Splits a multiline area into non-empty items to send to Rust. */
export function splitItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
