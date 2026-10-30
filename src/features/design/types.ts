// Requirement-linked design types. They mirror the `ruth-api` DTOs
// (camelCase). Pure: no React, no Tauri. The adapter lives in client.ts.
import type { ArtifactDto } from "../requirements/types";

export type DesignKind = "flow" | "data_model";

export interface UsageDto {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

export type DesignProposalState = "pending" | "accepted" | "discarded";

export interface DesignProposalDto {
  title: string;
  /** Authoritative JSON spec. */
  spec: unknown;
  /** Rust-derived Mermaid (read-only). */
  mermaid: string;
  explanation: string;
  state: DesignProposalState;
  artifactId?: string | null;
}

export interface DesignGenerationDto {
  id: string;
  projectId: string;
  moduleId: string;
  kind: DesignKind;
  model: string;
  contextVersionIds: string[];
  templateVersion: number;
  usage: UsageDto;
  createdAt: string;
  stale: boolean;
  questions: string[];
  proposal: DesignProposalDto;
  /** Fixed target (update proposals only). */
  targetArtifactId?: string | null;
  targetVersionId?: string | null;
}

export interface DesignContextPreview {
  artifactId: string;
  versionId: string;
  chars: number;
  excerpt: string;
  approved: boolean;
  title: string | null;
}

export interface ValidatedDesignDto {
  canonical: string;
  mermaid: string;
}

/** The design generation expired: the context changed. */
export const DESIGN_STALE = "design_stale";

/** The design proposal is discarded. */
export const DESIGN_DISCARDED = "design_discarded";

/** No saved sources selected. */
export const EMPTY_SELECTION = "empty_selection";

/** The update is blocked: something must be reviewed first. */
export const UPDATE_BLOCKED = "update_blocked";

/** The update proposal expired: target or sources moved. */
export const UPDATE_STALE = "update_stale";

/** The proposal updates another artifact: it cannot be accepted here. */
export const UPDATE_WRONG_TARGET = "update_wrong_target";

/** Declared sources stale when saving a manual review. */
export const DESIGN_STALE_SOURCES = "design_stale_sources";

/** Manual review without declared sources. */
export const DESIGN_NO_SOURCES = "design_no_sources";

/** Declared source missing on save. */
export const DESIGN_SOURCE_MISSING = "design_source_missing";

/** Malformed visual layout. */
export const DESIGN_LAYOUT_INVALID = "design_layout_invalid";

export interface UpdateBlockerDto {
  code: string;
  message: string;
  artifactId?: string | null;
}

export interface UpdateSourceDto {
  artifactId: string;
  kind: string;
  usedVersionId: string;
  usedContent: string;
  currentVersionId: string;
  currentContent: string;
  changed: boolean;
  currentApproved: boolean;
  currentValid: boolean;
}

export interface UpdateOriginDto {
  artifactId: string;
  fromVersionId: string;
  fromContent: string;
  currentVersionId: string;
  currentContent: string;
}

export interface UpdateContextPreview {
  target: ArtifactDto;
  kind: DesignKind;
  currentVersionId: string;
  currentNumber: number;
  currentSpec: unknown;
  sources: UpdateSourceDto[];
  origin?: UpdateOriginDto | null;
  paths: string[][];
  blockers: UpdateBlockerDto[];
  canGenerate: boolean;
}

export interface DiffItemDto {
  kind: string;
  id: string;
  detail: string;
}

export interface DesignDiffDto {
  added: DiffItemDto[];
  removed: DiffItemDto[];
  modified: DiffItemDto[];
}

/** Readable labels for design kinds. */
export const DESIGN_KIND_LABELS: Record<DesignKind, string> = {
  flow: "Operation flow",
  data_model: "Entity-relationship model",
};
