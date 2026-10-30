// Pure delivery-dialog coordination: response freshness, ZIP naming and
// size formatting. No React, no Tauri.

/** A late response never overwrites a newer query. */
export function isStaleBaselineResponse(currentKey: string, responseKey: string): boolean {
  return currentKey !== responseKey;
}

/** A preparation query key: project + module + selection. */
export function prepareKey(projectId: string, moduleId: string, artifactIds: string[]): string {
  return [projectId, moduleId, ...[...artifactIds].sort()].join("\u0000");
}

/**
 * Suggested file name for the ZIP, derived from the human name and the
 * baseline ID. Lowercase, digits and dashes only; never raw free titles
 * (they could carry path separators).
 */
export function defaultZipName(name: string, baselineId: string): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "delivery";
  const safeId =
    baselineId.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) ||
    "baseline";
  return `${slug}-${safeId}.zip`;
}

/** Readable size for the package preview. */
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
      return "requirement";
    case "flow":
      return "flow";
    case "data_model":
      return "ER model";
    case "mockup":
      return "mockup";
    default:
      return kind;
  }
}

/** Readable explanation of a preparation blocker code. */
export function blockerTitle(code: string): string {
  switch (code) {
    case "draft":
      return "Unapproved";
    case "stale_sources":
      return "Stale sources";
    case "stale_expected":
      return "Stale version";
    case "missing_sources":
      return "Sources out of scope";
    case "not_in_scope":
      return "Out of scope";
    default:
      return code;
  }
}
