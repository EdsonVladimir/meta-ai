// Tipos de impacto. Reflejan los DTOs de `ruth-api` (camelCase).
// Pure: no React, no Tauri. The adapter lives in client.ts.
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

/** Query key: a response only counts for its exact query. */
export function impactQueryKey(
  projectId: string,
  artifactId: string,
  fromVersionId: string | null,
  refreshToken: number,
): string {
  return `${projectId}\n${artifactId}\n${fromVersionId ?? ""}\n${refreshToken}`;
}
