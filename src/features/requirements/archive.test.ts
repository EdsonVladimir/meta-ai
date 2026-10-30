// Pure archive and delete: effective archiving, selection cleanup and
// draft protection.
import { describe, expect, test } from "vitest";
import {
  archiveDraftGuard,
  isEffectivelyArchived,
  selectionAfterDelete,
  type ArchiveTarget,
} from "./archive";
import type { Selection } from "./uiStore";

const FULL: Selection = {
  projectId: "proy-1",
  moduleId: "mod-1",
  requirementId: "req-1",
  designId: "flujo-1",
  mockupId: "mockup-1", screenId: null,
};

describe("effective archiving", () => {
  test("its own or the module one suffices", () => {
    expect(isEffectivelyArchived(false, false)).toBe(false);
    expect(isEffectivelyArchived(true, false)).toBe(true);
    expect(isEffectivelyArchived(false, true)).toBe(true);
    expect(isEffectivelyArchived(true, true)).toBe(true);
  });
});

describe("selection after deleting", () => {
  test("deleting a requirement clears only the requirement", () => {
    const target: ArchiveTarget = {
      kind: "requirement",
      projectId: "proy-1",
      moduleId: "mod-1",
      artifactId: "req-1",
    };
    expect(selectionAfterDelete(FULL, target)).toEqual({ ...FULL, requirementId: null });
  });

  test("deleting another requirement does not touch the selection", () => {
    const target: ArchiveTarget = {
      kind: "requirement",
      projectId: "proy-1",
      moduleId: "mod-1",
      artifactId: "req-9",
    };
    expect(selectionAfterDelete(FULL, target)).toBe(FULL);
  });

  test("deleting the module clears module, requirement, design and mockup", () => {
    const target: ArchiveTarget = { kind: "module", projectId: "proy-1", moduleId: "mod-1" };
    expect(selectionAfterDelete(FULL, target)).toEqual({
      projectId: "proy-1",
      moduleId: null,
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    });
  });

  test("deleting another module does not touch the selection", () => {
    const target: ArchiveTarget = { kind: "module", projectId: "proy-1", moduleId: "mod-9" };
    expect(selectionAfterDelete(FULL, target)).toBe(FULL);
  });

  test("deleting the project clears everything", () => {
    const target: ArchiveTarget = { kind: "project", projectId: "proy-1" };
    expect(selectionAfterDelete(FULL, target)).toEqual({
      projectId: null,
      moduleId: null,
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    });
  });

  test("deleting another project does not touch the selection", () => {
    const target: ArchiveTarget = { kind: "project", projectId: "proy-9" };
    expect(selectionAfterDelete(FULL, target)).toBe(FULL);
  });
});

describe("draft protection", () => {
  test("a requirement only protects its own draft", () => {
    const target: ArchiveTarget = {
      kind: "requirement",
      projectId: "proy-1",
      moduleId: "mod-1",
      artifactId: "req-1",
    };
    expect(
      archiveDraftGuard({
        target,
        selection: FULL,
        requirementDirty: true,
        visualDirty: true,
      }),
    ).toBe("requirement");
    expect(
      archiveDraftGuard({
        target,
        selection: FULL,
        requirementDirty: false,
        visualDirty: true,
      }),
    ).toBeNull();
    expect(
      archiveDraftGuard({
        target: { ...target, artifactId: "req-9" },
        selection: FULL,
        requirementDirty: true,
        visualDirty: false,
      }),
    ).toBeNull();
  });

  test("a module protects the selected draft inside, requirement first", () => {
    const target: ArchiveTarget = { kind: "module", projectId: "proy-1", moduleId: "mod-1" };
    expect(
      archiveDraftGuard({
        target,
        selection: FULL,
        requirementDirty: true,
        visualDirty: true,
      }),
    ).toBe("requirement");
    expect(
      archiveDraftGuard({
        target,
        selection: { ...FULL, requirementId: null },
        requirementDirty: true,
        visualDirty: true,
      }),
    ).toBe("visual");
    expect(
      archiveDraftGuard({
        target,
        selection: FULL,
        requirementDirty: false,
        visualDirty: false,
      }),
    ).toBeNull();
    expect(
      archiveDraftGuard({
        target,
        selection: { ...FULL, moduleId: "mod-9" },
        requirementDirty: true,
        visualDirty: true,
      }),
    ).toBeNull();
  });

  test("a project protects any draft inside the project", () => {
    const target: ArchiveTarget = { kind: "project", projectId: "proy-1" };
    // Even from another module: still inside the project.
    expect(
      archiveDraftGuard({
        target,
        selection: { ...FULL, moduleId: "mod-9" },
        requirementDirty: true,
        visualDirty: true,
      }),
    ).toBe("requirement");
    expect(
      archiveDraftGuard({
        target,
        selection: { ...FULL, requirementId: null },
        requirementDirty: false,
        visualDirty: true,
      }),
    ).toBe("visual");
    expect(
      archiveDraftGuard({
        target,
        selection: { ...FULL, requirementId: null, designId: null },
        requirementDirty: false,
        visualDirty: false,
        mockupDirty: true,
      }),
    ).toBe("mockup");
    // Outside the project or without drafts: clear to go.
    expect(
      archiveDraftGuard({
        target,
        selection: { ...FULL, projectId: "proy-9" },
        requirementDirty: true,
        visualDirty: true,
        mockupDirty: true,
      }),
    ).toBeNull();
    expect(
      archiveDraftGuard({
        target,
        selection: FULL,
        requirementDirty: false,
        visualDirty: false,
        mockupDirty: false,
      }),
    ).toBeNull();
  });
});
