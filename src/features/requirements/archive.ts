// Pure archive and delete helpers: effective archiving, selection cleanup
// after deleting, and which draft goes first before operating. No React,
// no Tauri: tested with vitest without DOM.
import type { Selection } from "./uiStore";

export type ArchiveTarget =
  | { kind: "project"; projectId: string }
  | { kind: "module"; projectId: string; moduleId: string }
  | { kind: "requirement"; projectId: string; moduleId: string; artifactId: string };

export type ArchiveAction = "archive" | "restore" | "delete";

/** Effective archiving: its own or the module's by context. */
export function isEffectivelyArchived(
  artifactArchived: boolean,
  moduleArchived: boolean,
): boolean {
  return artifactArchived || moduleArchived;
}

/**
 * Selection after deleting: removes what no longer exists and keeps the
 * rest. Deleting a requirement clears only the requirement; deleting a
 * module clears module, requirement and design (everything lived inside);
 * deleting a project clears it all (no context left).
 */
export function selectionAfterDelete(selection: Selection, target: ArchiveTarget): Selection {
  if (target.kind === "project") {
    if (selection.projectId !== target.projectId) return selection;
    return {
      projectId: null,
      moduleId: null,
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    };
  }
  if (target.kind === "requirement") {
    if (
      selection.projectId !== target.projectId ||
      selection.moduleId !== target.moduleId ||
      selection.requirementId !== target.artifactId
    ) {
      return selection;
    }
    return { ...selection, requirementId: null };
  }
  if (selection.projectId !== target.projectId || selection.moduleId !== target.moduleId) {
    return selection;
  }
  return { projectId: selection.projectId, moduleId: null, requirementId: null, designId: null, mockupId: null, screenId: null };
}

/**
 * Which draft asks for save/discard/cancel before operating? Archiving or
 * deleting a requirement only protects its own draft; a module protects
 * the selected requirement, design or mockup draft inside (requirement
 * first, as in navigation); a project protects any draft inside the
 * project. Null = clear to go.
 */
export function archiveDraftGuard(input: {
  target: ArchiveTarget;
  selection: Selection;
  requirementDirty: boolean;
  visualDirty: boolean;
  mockupDirty?: boolean;
}): "requirement" | "visual" | "mockup" | null {
  const { target, selection, requirementDirty, visualDirty, mockupDirty } = input;
  if (target.kind === "requirement") {
    const same =
      selection.projectId === target.projectId &&
      selection.moduleId === target.moduleId &&
      selection.requirementId === target.artifactId;
    return same && requirementDirty ? "requirement" : null;
  }
  // A project protects any draft inside; a module only its own.
  const inside =
    target.kind === "project"
      ? selection.projectId === target.projectId
      : selection.projectId === target.projectId && selection.moduleId === target.moduleId;
  if (!inside) return null;
  if (selection.requirementId !== null && requirementDirty) return "requirement";
  if (selection.designId !== null && visualDirty) return "visual";
  if (selection.mockupId !== null && mockupDirty === true) return "mockup";
  return null;
}
