// Archivo y borrado puros: archivado efectivo, limpieza de selección y
// protección de borradores.
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
  mockupId: "mockup-1",
};

describe("archivado efectivo", () => {
  test("basta el propio o el del módulo", () => {
    expect(isEffectivelyArchived(false, false)).toBe(false);
    expect(isEffectivelyArchived(true, false)).toBe(true);
    expect(isEffectivelyArchived(false, true)).toBe(true);
    expect(isEffectivelyArchived(true, true)).toBe(true);
  });
});

describe("selección tras eliminar", () => {
  test("eliminar un requisito limpia solo el requisito", () => {
    const target: ArchiveTarget = {
      kind: "requirement",
      projectId: "proy-1",
      moduleId: "mod-1",
      artifactId: "req-1",
    };
    expect(selectionAfterDelete(FULL, target)).toEqual({ ...FULL, requirementId: null });
  });

  test("eliminar otro requisito no toca la selección", () => {
    const target: ArchiveTarget = {
      kind: "requirement",
      projectId: "proy-1",
      moduleId: "mod-1",
      artifactId: "req-9",
    };
    expect(selectionAfterDelete(FULL, target)).toBe(FULL);
  });

  test("eliminar el módulo limpia módulo, requisito, diseño y mockup", () => {
    const target: ArchiveTarget = { kind: "module", projectId: "proy-1", moduleId: "mod-1" };
    expect(selectionAfterDelete(FULL, target)).toEqual({
      projectId: "proy-1",
      moduleId: null,
      requirementId: null,
      designId: null,
      mockupId: null,
    });
  });

  test("eliminar otro módulo no toca la selección", () => {
    const target: ArchiveTarget = { kind: "module", projectId: "proy-1", moduleId: "mod-9" };
    expect(selectionAfterDelete(FULL, target)).toBe(FULL);
  });
});

describe("protección de borradores", () => {
  test("un requisito solo protege su propio borrador", () => {
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

  test("un módulo protege el borrador seleccionado dentro, requisito primero", () => {
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
});
