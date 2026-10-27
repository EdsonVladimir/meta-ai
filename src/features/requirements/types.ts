// Tipos de requisitos. Reflejan los DTOs de `ruth-api` (camelCase).
// Puros: sin React, sin Tauri. El adaptador vive en client.ts.

export interface ProjectDto {
  id: string;
}

export interface ModuleDto {
  id: string;
  projectId: string;
}

export interface ArtifactDto {
  id: string;
  projectId: string;
  moduleId: string;
  kind: string;
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

/** Instantánea autoritativa de un requisito, tal como la sirve Rust. */
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

/** La versión actual cambió desde que se leyó: conservar el trabajo local. */
export const STALE_VERSION = "stale_version";

/** Fallo de la persistencia local (SQLite): recuperable, sin borrar nada. */
export const STORAGE_ERROR = "storage_error";

/** Estado del almacenamiento local, servido por `core_status`. */
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
  return { kind: "unexpected", message: "Error inesperado en la operación." };
}

export function currentVersion(detail: RequirementDetail): VersionDto | undefined {
  return detail.versions.find((v) => v.id === detail.currentVersionId);
}

/** Aprobaciones de una versión concreta, derivadas del historial. */
export function approvalsForVersion(
  detail: RequirementDetail,
  versionId: string,
): ApprovalDto[] {
  return detail.approvals.filter((a) => a.versionId === versionId);
}
