// Navegación contextual pura: construir la siguiente selección al navegar
// sin perder contexto compatible. Requisito, diseño y mockup coexisten;
// cambiar de proyecto o módulo limpia únicamente lo incompatible.
// Sin React ni Tauri.
import type { Selection } from "./uiStore";

/** Elegir proyecto: todo lo anterior pertenece a otro proyecto. */
export function withProject(current: Selection, projectId: string): Selection {
  if (current.projectId === projectId) return current;
  return { projectId, moduleId: null, requirementId: null, designId: null, mockupId: null };
}

/** Elegir módulo: los artefactos eran de otro módulo. */
export function withModule(current: Selection, projectId: string, moduleId: string): Selection {
  if (current.projectId === projectId && current.moduleId === moduleId) return current;
  return { projectId, moduleId, requirementId: null, designId: null, mockupId: null };
}

/**
 * Elegir requisito: conserva diseño y mockup si siguen en el mismo módulo;
 * al cambiar de módulo se limpian por incompatibles.
 */
export function withRequirement(
  current: Selection,
  projectId: string,
  moduleId: string,
  requirementId: string,
): Selection {
  const sameModule = current.projectId === projectId && current.moduleId === moduleId;
  return {
    projectId,
    moduleId,
    requirementId,
    designId: sameModule ? current.designId : null,
    mockupId: sameModule ? current.mockupId : null,
  };
}

/**
 * Elegir diseño: conserva requisito y mockup si siguen en el mismo módulo;
 * al cambiar de módulo se limpian por incompatibles.
 */
export function withDesign(
  current: Selection,
  projectId: string,
  moduleId: string,
  designId: string,
): Selection {
  const sameModule = current.projectId === projectId && current.moduleId === moduleId;
  return {
    projectId,
    moduleId,
    requirementId: sameModule ? current.requirementId : null,
    designId,
    mockupId: sameModule ? current.mockupId : null,
  };
}

/**
 * Elegir mockup: conserva requisito y diseño si siguen en el mismo módulo;
 * al cambiar de módulo se limpian por incompatibles.
 */
export function withMockup(
  current: Selection,
  projectId: string,
  moduleId: string,
  mockupId: string,
): Selection {
  const sameModule = current.projectId === projectId && current.moduleId === moduleId;
  return {
    projectId,
    moduleId,
    requirementId: sameModule ? current.requirementId : null,
    designId: sameModule ? current.designId : null,
    mockupId,
  };
}
