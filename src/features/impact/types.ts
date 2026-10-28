// Tipos de impacto. Reflejan los DTOs de `ruth-api` (camelCase).
// Puros: sin React, sin Tauri. El adaptador vive en client.ts.
import type { ApprovalDto, ArtifactDto } from "../requirements/types";

export interface ImpactVersionDto {
  id: string;
  number: number;
  content: string;
}

export interface ImpactOriginDto {
  artifact: ArtifactDto;
  fromVersion: ImpactVersionDto;
  currentVersion: ImpactVersionDto;
}

export interface SourcePinDto {
  usedVersionId: string;
  sourceArtifactId: string | null;
  currentVersionId: string | null;
  stale: boolean;
}

export interface ImpactedDto {
  artifact: ArtifactDto;
  currentVersionId: string;
  currentNumber: number;
  requiresReview: boolean;
  staleSources: string[];
  pins: SourcePinDto[];
  approvals: ApprovalDto[];
  approvedBefore: boolean;
  paths: string[][];
}

export interface ImpactReportDto {
  projectId: string;
  origin: ImpactOriginDto;
  affected: ImpactedDto[];
}

/** Clave de consulta: una respuesta solo vale para su consulta exacta. */
export function impactQueryKey(
  projectId: string,
  artifactId: string,
  fromVersionId: string | null,
  refreshToken: number,
): string {
  return `${projectId}\n${artifactId}\n${fromVersionId ?? ""}\n${refreshToken}`;
}
