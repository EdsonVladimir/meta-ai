// Tipos de generación asistida. Reflejan los DTOs de `ruth-api` (camelCase).
// Puros: sin React, sin Tauri. El adaptador vive en client.ts.

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

/** La generación caducó: cambió el contexto; hay que generar de nuevo. */
export const GENERATION_STALE = "generation_stale";

/** Ya hay una generación en curso para este módulo. */
export const GENERATION_BUSY = "generation_busy";

export interface AcceptProposalFields {
  title: string;
  description: string;
  acceptance: string[];
  assumptions: string[];
}
