// Tipos de diseño vinculado a requisitos. Reflejan los DTOs de `ruth-api`
// (camelCase). Puros: sin React, sin Tauri. El adaptador vive en client.ts.

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
}

export interface DesignContextPreview {
  artifactId: string;
  versionId: string;
  chars: number;
  excerpt: string;
  approved: boolean;
}

export interface ValidatedDesignDto {
  canonical: string;
  mermaid: string;
}

/** La generación de diseño caducó: cambió el contexto. */
export const DESIGN_STALE = "design_stale";

/** La propuesta de diseño está descartada. */
export const DESIGN_DISCARDED = "design_discarded";

/** Sin requisitos aprobados seleccionados como fuentes. */
export const EMPTY_SELECTION = "empty_selection";

/** Etiquetas legibles para los tipos de diseño. */
export const DESIGN_KIND_LABELS: Record<DesignKind, string> = {
  flow: "Flujo de operación",
  data_model: "Modelo entidad-relación",
};
