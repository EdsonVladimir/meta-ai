// Requirement types. They mirror the `ruth-api` DTOs (camelCase).
// Pure: no React, no Tauri. The adapter lives in client.ts.

export interface ProjectDto {
  id: string;
  name: string;
}

export interface ModuleDto {
  id: string;
  projectId: string;
  name: string;
  archived: boolean;
}

export interface ArtifactDto {
  id: string;
  projectId: string;
  moduleId: string;
  kind: string;
  title: string | null;
  archived: boolean;
}

export interface ProvenanceDto {
  kind: string;
  by: string;
}

export interface VersionDto {
  id: string;
  number: number;
  content: string;
  provenance: ProvenanceDto;
  sources: string[];
}

export interface ApprovalDto {
  versionId: string;
  approvedBy: string;
  at: string;
}

/** Authoritative snapshot of a requirement, as served by Rust. */
export interface RequirementDetail {
  artifact: ArtifactDto;
  versions: VersionDto[];
  approvals: ApprovalDto[];
  currentVersionId: string;
}

export interface CoreApiError {
  kind: string;
  message: string;
}

/** The current version changed since it was read: keep the local work. */
export const STALE_VERSION = "stale_version";

/** Local persistence (SQLite) failure: recoverable, deletes nothing. */
export const STORAGE_ERROR = "storage_error";

/** Operation on an archived module: restore to continue. */
export const ARCHIVED_MODULE = "archived_module";

/** Operation on an archived artifact: restore to continue. */
export const ARCHIVED_ARTIFACT = "archived_artifact";

/** The version depends on an archived source. */
export const ARCHIVED_SOURCE = "archived_source";

/** Empty name or title. */
export const EMPTY_NAME = "empty_name";

/** Name or title longer than the maximum. */
export const NAME_TOO_LONG = "name_too_long";

/** The name changed since it was read: review and retry. */
export const STALE_NAME = "stale_name";

/** Dependent of the archive target, with its module. */
export interface ArchiveDependentDto {
  artifact: ArtifactDto;
  sameModule: boolean;
}

/** Baseline including the target. */
export interface ArchiveBaselineDto {
  id: string;
  name: string;
}

/** Generation mentioning the target. */
export interface ArchiveGenerationDto {
  id: string;
  log: string;
  role: string;
}

/** Permanent-deletion blocker. */
export interface ArchiveBlockerDto {
  code: string;
  message: string;
}

/** Advisory summary before archiving or deleting. */
export interface ArchivePreviewDto {
  projectId: string;
  kind: string;
  id: string;
  archived: boolean;
  contents: ArtifactDto[];
  /** Project modules. Only for `kind === "project"`. */
  modules: ModuleDto[];
  dependents: ArchiveDependentDto[];
  baselines: ArchiveBaselineDto[];
  /** Work deliveries including it (`{id, name}` shape). */
  deliveries: ArchiveBaselineDto[];
  generations: ArchiveGenerationDto[];
  approvals: number;
  versions: number;
  canDelete: boolean;
  deleteBlockers: ArchiveBlockerDto[];
}

/** Local storage status, served by `core_status`. */
export interface CoreStatus {
  ready: boolean;
  message?: string | null;
  dbPath?: string | null;
}

export function normalizeCoreError(raw: unknown): CoreApiError {
  if (raw !== null && typeof raw === "object") {
    const candidate = raw as Partial<CoreApiError>;
    if (typeof candidate.message === "string") {
      return {
        kind: typeof candidate.kind === "string" ? candidate.kind : "unexpected",
        message: candidate.message,
      };
    }
  }
  return { kind: "unexpected", message: "Unexpected operation error." };
}

export function currentVersion(detail: RequirementDetail): VersionDto | undefined {
  return detail.versions.find((v) => v.id === detail.currentVersionId);
}

/** Approvals of one version, derived from history. */
export function approvalsForVersion(
  detail: RequirementDetail,
  versionId: string,
): ApprovalDto[] {
  return detail.approvals.filter((a) => a.versionId === versionId);
}
