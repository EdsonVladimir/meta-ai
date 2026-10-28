// Ayudas puras de archivo y borrado: archivado efectivo, limpieza de
// selección tras eliminar y qué borrador pide turno antes de operar.
// Sin React ni Tauri: se prueba con vitest sin DOM.
import type { Selection } from "./uiStore";

export type ArchiveTarget =
  | { kind: "module"; projectId: string; moduleId: string }
  | { kind: "requirement"; projectId: string; moduleId: string; artifactId: string };

export type ArchiveAction = "archive" | "restore" | "delete";

/** Archivado efectivo: el propio o el del módulo por contexto. */
export function isEffectivelyArchived(
  artifactArchived: boolean,
  moduleArchived: boolean,
): boolean {
  return artifactArchived || moduleArchived;
}

/**
 * Selección tras eliminar: quita lo que ya no existe y conserva el resto.
 * Eliminar un requisito limpia solo el requisito; eliminar un módulo limpia
 * módulo, requisito y diseño (todo vivía dentro).
 */
export function selectionAfterDelete(selection: Selection, target: ArchiveTarget): Selection {
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
  return { projectId: selection.projectId, moduleId: null, requirementId: null, designId: null, mockupId: null };
}

/**
 * ¿Qué borrador pide guardar/descartar/cancelar antes de operar? Archivar o
 * eliminar un requisito solo protege su propio borrador; un módulo protege
 * el del requisito, diseño o mockup seleccionado dentro (el requisito
 * primero, como en la navegación). Null = vía libre.
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
  const inside =
    selection.projectId === target.projectId && selection.moduleId === target.moduleId;
  if (!inside) return null;
  if (selection.requirementId !== null && requirementDirty) return "requirement";
  if (selection.designId !== null && visualDirty) return "visual";
  if (selection.mockupId !== null && mockupDirty === true) return "mockup";
  return null;
}
