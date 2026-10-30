// Pure impact-view coordination: response freshness, derived pending
// counts and pagination. No React, no Tauri.
import type { ImpactReportDto, ImpactedDto } from "./types";

/** A late response never overwrites a newer query. */
export function isStaleImpactResponse(currentKey: string, responseKey: string): boolean {
  return currentKey !== responseKey;
}

/** Unique pending items derived from the report (never hardcoded). */
export function countPendingUnique(report: ImpactReportDto): number {
  const seen = new Set<string>();
  let pending = 0;
  for (const item of report.affected) {
    if (seen.has(item.artifact.id)) continue;
    seen.add(item.artifact.id);
    if (item.requiresReview) pending += 1;
  }
  return pending;
}

export interface PageSlice {
  page: number;
  pages: number;
  start: number;
  end: number;
}

/** Table window: the full total is always kept. */
export function paginate(total: number, page: number, pageSize: number): PageSlice {
  const size = Math.max(1, pageSize);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * size;
  return { page: current, pages, start, end: Math.min(total, start + size) };
}

/** Graph node cap: beyond it the truncation is announced. */
export const MAX_GRAPH_NODES = 60;

export type ImpactDisplayStatus = "pending" | "awaiting_approval" | "ok";

/**
 * Honest status of an affected item: pending source updates, updated
 * sources but pending approval, or current. Only reorders flags computed
 * by the core; never recomputes liveness.
 */
export function impactStatus(item: ImpactedDto): ImpactDisplayStatus {
  if (item.requiresReview) return "pending";
  if (item.approvedBefore && item.approvals.length === 0) return "awaiting_approval";
  return "ok";
}
