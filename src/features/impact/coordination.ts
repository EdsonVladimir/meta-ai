// Coordinación pura de la vista de impacto: frescura de respuestas,
// conteo derivado de pendientes y paginación. Sin React ni Tauri.
import type { ImpactReportDto, ImpactedDto } from "./types";

/** Una respuesta tardía nunca sobrescribe una consulta más reciente. */
export function isStaleImpactResponse(currentKey: string, responseKey: string): boolean {
  return currentKey !== responseKey;
}

/** Pendientes únicos derivados del informe (nunca hardcodeado). */
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

/** Ventana de la tabla: el total completo siempre se conserva. */
export function paginate(total: number, page: number, pageSize: number): PageSlice {
  const size = Math.max(1, pageSize);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * size;
  return { page: current, pages, start, end: Math.min(total, start + size) };
}

/** Tope de nodos del grafo: más allá se avisa del truncado. */
export const MAX_GRAPH_NODES = 60;

export type ImpactDisplayStatus = "pending" | "awaiting_approval" | "ok";

/**
 * Estado honesto de un afectado: pendiente de actualizar fuentes,
 * fuentes actualizadas pero pendiente de aprobación, o al día. Solo
 * reordena banderas calculadas por el núcleo; no recalcula vigencia.
 */
export function impactStatus(item: ImpactedDto): ImpactDisplayStatus {
  if (item.requiresReview) return "pending";
  if (item.approvedBefore && item.approvals.length === 0) return "awaiting_approval";
  return "ok";
}
