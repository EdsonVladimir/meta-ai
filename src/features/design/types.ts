// Tipos de diseño vinculado a requisitos. Reflejan los DTOs de `ruth-api`
// (camelCase). Puros: sin React, sin Tauri. El adaptador vive en client.ts.
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
  /** Especificación JSON autoritativa. */
  spec: unknown;
  /** Mermaid derivado en Rust (solo lectura). */
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
  /** Objetivo fijado (solo propuestas de actualización). */
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

/** La generación de diseño caducó: cambió el contexto. */
export const DESIGN_STALE = "design_stale";

/** La propuesta de diseño está descartada. */
export const DESIGN_DISCARDED = "design_discarded";

/** Sin fuentes guardadas seleccionadas. */
export const EMPTY_SELECTION = "empty_selection";

/** La actualización está bloqueada: hay que revisar algo primero. */
export const UPDATE_BLOCKED = "update_blocked";

/** La propuesta de actualización caducó: objetivo o fuentes se movieron. */
export const UPDATE_STALE = "update_stale";

/** La propuesta actualiza otro artefacto: no puede aceptarse aquí. */
export const UPDATE_WRONG_TARGET = "update_wrong_target";

/** Fuentes declaradas obsoletas al guardar una revisión manual. */
export const DESIGN_STALE_SOURCES = "design_stale_sources";

/** Revisión manual sin fuentes declaradas. */
export const DESIGN_NO_SOURCES = "design_no_sources";

/** Fuente declarada inexistente al guardar. */
export const DESIGN_SOURCE_MISSING = "design_source_missing";

/** Disposición visual malformada. */
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

/** Etiquetas legibles para los tipos de diseño. */
export const DESIGN_KIND_LABELS: Record<DesignKind, string> = {
  flow: "Flujo de operación",
  data_model: "Modelo entidad-relación",
};
