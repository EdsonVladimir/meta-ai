// Pure contextual navigation: build the next selection when navigating
// without losing compatible context. Requirement, design and mockup
// coexist; switching projects or modules only clears what is incompatible.
// No React, no Tauri.
import type { Selection } from "./uiStore";

/** Pick a project: everything before belonged to another project. */
export function withProject(current: Selection, projectId: string): Selection {
  if (current.projectId === projectId) return current;
  return { projectId, moduleId: null, requirementId: null, designId: null, mockupId: null, screenId: null };
}

/** Pick a module: the artifacts belonged to another module. */
export function withModule(current: Selection, projectId: string, moduleId: string): Selection {
  if (current.projectId === projectId && current.moduleId === moduleId) return current;
  return { projectId, moduleId, requirementId: null, designId: null, mockupId: null, screenId: null };
}

/**
 * Pick a requirement: keeps design and mockup when they stay in the same
 * module; switching modules clears them as incompatible.
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
    screenId: sameModule ? current.screenId : null,
  };
}

/**
 * Pick a design: keeps requirement and mockup when they stay in the same
 * module; switching modules clears them as incompatible.
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
    screenId: sameModule ? current.screenId : null,
  };
}

/**
 * Pick a mockup: keeps requirement and design when they stay in the same
 * module; switching modules clears them as incompatible.
 */
export function withMockup(
  current: Selection,
  projectId: string,
  moduleId: string,
  mockupId: string,
): Selection {
  const sameModule = current.projectId === projectId && current.moduleId === moduleId;
  const sameMockup = sameModule && current.mockupId === mockupId;
  return {
    projectId,
    moduleId,
    requirementId: sameModule ? current.requirementId : null,
    designId: sameModule ? current.designId : null,
    mockupId,
    // Same mockup: keeps its screen; another one: no screen (the editor
    // opens the first and reports it back).
    screenId: sameMockup ? current.screenId : null,
  };
}

/**
 * Pick a screen: pins mockup and screen, keeps the requirement and design
 * of the same module. Switching views never touches the selection: the
 * active screen survives.
 */
export function withScreen(
  current: Selection,
  projectId: string,
  moduleId: string,
  mockupId: string,
  screenId: string,
): Selection {
  const sameModule = current.projectId === projectId && current.moduleId === moduleId;
  return {
    projectId,
    moduleId,
    requirementId: sameModule ? current.requirementId : null,
    designId: sameModule ? current.designId : null,
    mockupId,
    screenId,
  };
}
