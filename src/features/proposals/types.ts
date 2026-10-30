// Assisted-generation types. They mirror the `ruth-api` DTOs (camelCase).
// Pure: no React, no Tauri. The adapter lives in client.ts.

export interface UsageDto {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

export type ProposalState = "pending" | "accepted" | "discarded";

export interface ProposalDto {
  tempId: string;
  title: string;
  description: string;
  acceptance: string[];
  assumptions: string[];
  state: ProposalState;
  artifactId?: string | null;
}

export interface GenerationDto {
  id: string;
  projectId: string;
  moduleId: string;
  model: string;
  description: string;
  contextVersionIds: string[];
  templateVersion: number;
  usage: UsageDto;
  createdAt: string;
  stale: boolean;
  questions: string[];
  proposals: ProposalDto[];
}

export interface GenerationContextPreview {
  artifactId: string;
  versionId: string;
  chars: number;
  excerpt: string;
  title: string | null;
}

/** The generation went stale: context changed; generate again. */
export const GENERATION_STALE = "generation_stale";

/** A generation is already running for this module. */
export const GENERATION_BUSY = "generation_busy";

export interface AcceptProposalFields {
  title: string;
  description: string;
  acceptance: string[];
  assumptions: string[];
}
