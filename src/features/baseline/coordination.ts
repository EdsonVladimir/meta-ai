// Coordinación pura del diálogo de entregas: frescura de respuestas,
// nombre del ZIP y formato de tamaños. Sin React ni Tauri.

/** Una respuesta tardía nunca sobrescribe una consulta más reciente. */
export function isStaleBaselineResponse(currentKey: string, responseKey: string): boolean {
  return currentKey !== responseKey;
}

/** Clave de una consulta de preparación: proyecto + módulo + selección. */
export function prepareKey(projectId: string, moduleId: string, artifactIds: string[]): string {
  return [projectId, moduleId, ...[...artifactIds].sort()].join("\u0000");
}

/**
 * Nombre de archivo sugerido para el ZIP, derivado del nombre humano y del
 * ID de la baseline. Solo minúsculas, dígitos y guiones; nunca títulos libres
 * tal cual (podrían llevar separadores de ruta).
 */
export function defaultZipName(name: string, baselineId: string): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "entrega";
  const safeId =
    baselineId.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) ||
    "baseline";
  return `${slug}-${safeId}.zip`;
}

/** Tamaño legible para la vista previa del paquete. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "requirement":
      return "requisito";
    case "flow":
      return "flujo";
    case "data_model":
      return "modelo ER";
    case "mockup":
      return "mockup";
    default:
      return kind;
  }
}

/** Explicación legible de un código de bloqueo de la preparación. */
export function blockerTitle(code: string): string {
  switch (code) {
    case "draft":
      return "Sin aprobar";
    case "stale_sources":
      return "Fuentes desactualizadas";
    case "stale_expected":
      return "Versión obsoleta";
    case "missing_sources":
      return "Fuentes fuera del alcance";
    case "not_in_scope":
      return "Fuera del alcance";
    default:
      return code;
  }
}
