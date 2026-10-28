// Tipos de requisitos. Reflejan los DTOs de `ruth-api` (camelCase).
// Puros: sin React, sin Tauri. El adaptador vive en client.ts.

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

/** Operación sobre un módulo archivado: restaurar para continuar. */
export const ARCHIVED_MODULE = "archived_module";

/** Operación sobre un artefacto archivado: restaurar para continuar. */
export const ARCHIVED_ARTIFACT = "archived_artifact";

/** La versión depende de una fuente archivada. */
export const ARCHIVED_SOURCE = "archived_source";

/** Nombre o título vacío. */
export const EMPTY_NAME = "empty_name";

/** Nombre o título más largo del máximo. */
export const NAME_TOO_LONG = "name_too_long";

/** El nombre cambió desde que se leyó: revisar y reintentar. */
export const STALE_NAME = "stale_name";

/** Dependiente del objetivo de archivo, con su módulo. */
export interface ArchiveDependentDto {
  artifact: ArtifactDto;
  sameModule: boolean;
}

/** Baseline que incluye al objetivo. */
export interface ArchiveBaselineDto {
  id: string;
  name: string;
}

/** Generación que menciona al objetivo. */
export interface ArchiveGenerationDto {
  id: string;
  log: string;
  role: string;
}

/** Bloqueo del borrado definitivo. */
export interface ArchiveBlockerDto {
  code: string;
  message: string;
}

/** Resumen consultivo antes de archivar o eliminar. */
export interface ArchivePreviewDto {
  projectId: string;
  kind: string;
  id: string;
  archived: boolean;
  contents: ArtifactDto[];
  dependents: ArchiveDependentDto[];
  baselines: ArchiveBaselineDto[];
  /** Entregas de trabajo que lo incluyen (forma `{id, name}`). */
  deliveries: ArchiveBaselineDto[];
  generations: ArchiveGenerationDto[];
  approvals: number;
  versions: number;
  canDelete: boolean;
  deleteBlockers: ArchiveBlockerDto[];
}

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
