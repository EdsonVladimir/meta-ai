// Header save state, derived from the per-document map. Pure: no
// React. The active document comes from selection + view; the rest only
// count (never an ambiguous global flag).
import type { CenterView, DocSaveState, Selection } from "./uiStore";

export type HeaderSaveState = "none" | "dirty" | "saving" | "saved" | "error";

export interface HeaderSave {
  state: HeaderSaveState;
  /** Documents with drafts other than the active one. */
  othersDirty: number;
  /** The active one's error, if any. */
  error: string | null;
}

export function docKey(kind: "req" | "design" | "mockup", id: string): string {
  return `${kind}:${id}`;
}

/** Document the center view edits, if any is open. */
export function activeDocKey(
  selection: Selection,
  centerView: CenterView,
  codeActiveKey: string | null = null,
): string | null {
  void centerView;
  if (codeActiveKey !== null) {
    return `code:${codeActiveKey}`;
  }
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

/** Keys with drafts, for the export dialog. */
export function dirtyDocKeys(docStatus: Record<string, DocSaveState>): string[] {
  return Object.entries(docStatus)
    .filter(([, value]) => value.dirty)
    .map(([key]) => key);
}
