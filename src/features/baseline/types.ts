// Tipos del hito 9: preparación de entregas, baselines y exportación.
// Espejan los DTOs de `ruth-api` (camelCase); la UI no recalcula vigencia.
import type { ArtifactDto, ProvenanceDto } from "../requirements/types";

export interface BaselineBlockerDto {
  code: string;
  message: string;
  artifactId: string | null;
}

export interface BaselineEntryPreviewDto {
  artifact: ArtifactDto;
  versionId: string;
  approvedBy: string | null;
  approvedAt: string | null;
  provenance: ProvenanceDto;
  staleSources: string[];
  sourceVersions: string[];
  autoIncluded: boolean;
}

export interface BaselineOutOfScopeDto {
  modules: Array<{ id: string; artifacts: string[] }>;
  artifacts: string[];
}

export interface BaselinePreviewDto {
  projectId: string;
  scopeModuleId: string;
  entries: BaselineEntryPreviewDto[];
  blockers: BaselineBlockerDto[];
  outOfScope: BaselineOutOfScopeDto;
  canCreate: boolean;
}

/**
 * Entrada histórica: espeja el DTO de Rust (artefacto anidado). `title` es
 * el título fijado al crear la baseline; `artifact.title` es el vigente y
 * solo sirve para contrastar (la entrega nunca lo usa).
 */
export interface BaselineEntryDto {
  artifact: ArtifactDto;
  kind: string;
  /** Título fijado al crear la baseline (jamás el vigente). */
  title: string | null;
  versionId: string;
  number: number;
  provenance: ProvenanceDto;
  approvals: Array<{ versionId: string; approvedBy: string; at: string }>;
  sources: string[];
}

export interface BaselineDto {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  scopeModuleId: string | null;
  at: string;
  entries: BaselineEntryDto[];
}

export interface BaselineSummaryDto {
  id: string;
  name: string;
  projectId: string;
  scopeModuleId: string | null;
  at: string;
  entryCount: number;
  advanced: boolean;
  advancedArtifacts: string[];
}

export interface ExportFileDto {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ExportPreviewDto {
  baselineId: string;
  exporterVersion: number;
  files: ExportFileDto[];
  totalBytes: number;
}

export interface ExportSaveDto {
  baselineId: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface DeliveryEntryPreviewDto {
  artifact: ArtifactDto;
  kind: string;
  versionId: string;
  number: number;
  approvedBy: string | null;
  approvedAt: string | null;
  provenance: ProvenanceDto;
  sources: string[];
  staleSources: string[];
}

export interface DeliveryPreviewDto {
  projectId: string;
  scopeModuleId: string;
  entries: DeliveryEntryPreviewDto[];
  outOfScope: BaselineOutOfScopeDto;
  canCreate: boolean;
  blockers: BaselineBlockerDto[];
  unreviewedCount: number;
  staleCount: number;
}

export interface DeliveryEntryDto {
  artifact: ArtifactDto;
  kind: string;
  /** Título fijado al crear la entrega (jamás el vigente). */
  title: string | null;
  versionId: string;
  number: number;
  provenance: ProvenanceDto;
  approvals: Array<{ versionId: string; approvedBy: string; at: string }>;
  sources: string[];
  staleSources: string[];
}

export interface DeliveryDto {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  scopeModuleId: string | null;
  at: string;
  entries: DeliveryEntryDto[];
}

export interface DeliverySummaryDto {
  id: string;
  name: string;
  projectId: string;
  scopeModuleId: string | null;
  at: string;
  entryCount: number;
  unreviewedCount: number;
  staleCount: number;
  advanced: boolean;
  advancedArtifacts: string[];
}

export interface DeliveryExportPreviewDto {
  deliveryId: string;
  exporterVersion: number;
  files: ExportFileDto[];
  totalBytes: number;
}

export interface DeliveryExportSaveDto {
  deliveryId: string;
  path: string;
  bytes: number;
  sha256: string;
}
