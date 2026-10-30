// Milestone 9 types: delivery preparation, baselines and export. They
// mirror the `ruth-api` DTOs (camelCase); the UI never recomputes liveness.
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
 * Historical entry: mirrors the Rust DTO (nested artifact). `title` is
 * the title pinned when the baseline was created; `artifact.title` is the
 * live one and only serves comparison (the delivery never uses it).
 */
export interface BaselineEntryDto {
  artifact: ArtifactDto;
  kind: string;
  /** Title pinned when the baseline was created (never the live one). */
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
  /** Title pinned when the delivery was created (never the live one). */
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
