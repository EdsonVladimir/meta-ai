// Estado de guardado del encabezado, derivado del mapa por documento.
// Puro: sin React. El documento activo sale de la selección + vista; los
// demás solo cuentan (nunca un flag global ambiguo).
import type { CenterView, DocSaveState, Selection } from "./uiStore";

export type HeaderSaveState = "none" | "dirty" | "saving" | "saved" | "error";

export interface HeaderSave {
  state: HeaderSaveState;
  /** Documentos con borrador distintos del activo. */
  othersDirty: number;
  /** Error del activo, si lo hay. */
  error: string | null;
}

export function docKey(kind: "req" | "design" | "mockup", id: string): string {
  return `${kind}:${id}`;
}

/** Documento que edita la vista central, si hay alguno abierto. */
export function activeDocKey(selection: Selection, centerView: CenterView): string | null {
  if (centerView === "requirements" && selection.requirementId !== null) {
    return docKey("req", selection.requirementId);
  }
  if (centerView === "design" && selection.designId !== null) {
    return docKey("design", selection.designId);
  }
  if (centerView === "mockups" && selection.mockupId !== null) {
    return docKey("mockup", selection.mockupId);
  }
  return null;
}

export function headerSave(
  docStatus: Record<string, DocSaveState>,
  activeKey: string | null,
): HeaderSave {
  let othersDirty = 0;
  for (const [key, value] of Object.entries(docStatus)) {
    if (key !== activeKey && value.dirty) othersDirty += 1;
  }
  if (activeKey === null) return { state: "none", othersDirty, error: null };
  const active = docStatus[activeKey];
  if (active === undefined) return { state: "saved", othersDirty, error: null };
  if (active.saving) return { state: "saving", othersDirty, error: null };
  if (active.error !== null) return { state: "error", othersDirty, error: active.error };
  if (active.dirty) return { state: "dirty", othersDirty, error: null };
  return { state: "saved", othersDirty, error: null };
}

/** Claves con borrador, para el diálogo de exportar. */
export function dirtyDocKeys(docStatus: Record<string, DocSaveState>): string[] {
  return Object.entries(docStatus)
    .filter(([, value]) => value.dirty)
    .map(([key]) => key);
}

export function docKindLabel(key: string): string {
  if (key.startsWith("req:")) return "requisito";
  if (key.startsWith("design:")) return "diseño";
  if (key.startsWith("mockup:")) return "mockup";
  return "documento";
}
