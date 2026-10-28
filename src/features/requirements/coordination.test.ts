import { describe, expect, it } from "vitest";
import {
  canApprove,
  draftReducer,
  EMPTY_DRAFT,
  EMPTY_REVIEW,
  needsConfirm,
  resolveSaveTarget,
  reviewReducer,
  saveState,
  shouldApplyResponse,
} from "./coordination";
import { approvalsForVersion, currentVersion, normalizeCoreError } from "./types";

describe("shouldApplyResponse", () => {
  it("aplica la última respuesta de la selección actual", () => {
    expect(
      shouldApplyResponse({ key: "req-1", epoch: 3 }, { key: "req-1", epoch: 3 }),
    ).toBe(true);
  });

  it("descarta respuestas de otro requisito", () => {
    expect(
      shouldApplyResponse({ key: "req-2", epoch: 3 }, { key: "req-1", epoch: 3 }),
    ).toBe(false);
  });

  it("descarta respuestas obsoletas del mismo requisito", () => {
    expect(
      shouldApplyResponse({ key: "req-1", epoch: 4 }, { key: "req-1", epoch: 3 }),
    ).toBe(false);
  });
});

describe("needsConfirm", () => {
  it("permite navegar sin borrador sucio", () => {
    expect(needsConfirm(false, "req-1", "req-2")).toBe(false);
  });

  it("permite re-seleccionar el mismo requisito", () => {
    expect(needsConfirm(true, "req-1", "req-1")).toBe(false);
  });

  it("pide confirmación al cambiar con borrador sucio", () => {
    expect(needsConfirm(true, "req-1", "req-2")).toBe(true);
    expect(needsConfirm(true, "req-1", null)).toBe(true);
  });
});

describe("draftReducer", () => {
  it("editar marca el borrador como sucio", () => {
    const next = draftReducer(
      { requirementId: "req-1", content: "a", base: "a", rev: 0, dirty: false },
      { type: "edit", content: "b" },
    );
    expect(next).toEqual({ requirementId: "req-1", content: "b", base: "a", rev: 1, dirty: true });
  });

  it("reescribir el contenido guardado elimina lo pendiente", () => {
    const dirty = { requirementId: "req-1", content: "b", base: "a", rev: 1, dirty: true };
    expect(draftReducer(dirty, { type: "edit", content: "a" })).toEqual({
      requirementId: "req-1",
      content: "a",
      base: "a",
      rev: 2,
      dirty: false,
    });
  });

  it("un refresco no sobrescribe el borrador sucio", () => {
    const dirty = { requirementId: "req-1", content: "mío", base: "v1", rev: 1, dirty: true };
    expect(
      draftReducer(dirty, { type: "snapshot", requirementId: "req-1", content: "otro" }),
    ).toBe(dirty);
  });

  it("un refresco adopta contenido con borrador limpio", () => {
    expect(
      draftReducer(EMPTY_DRAFT, {
        type: "snapshot",
        requirementId: "req-1",
        content: "v3",
      }),
    ).toEqual({ requirementId: "req-1", content: "v3", base: "v3", rev: 0, dirty: false });
  });

  it("un guardado fallido conserva el borrador", () => {
    const dirty = { requirementId: "req-1", content: "mío", base: "v1", rev: 1, dirty: true };
    expect(draftReducer(dirty, { type: "saveFailed" })).toBe(dirty);
  });

  it("el resultado solo limpia su propia petición", () => {
    const dirty = { requirementId: "req-1", content: "b", base: "a", rev: 1, dirty: true };
    expect(
      draftReducer(dirty, { type: "saved", requirementId: "req-1", content: "b", rev: 1 }),
    ).toEqual({ requirementId: "req-1", content: "b", base: "b", rev: 1, dirty: false });
  });

  it("lo editado durante el guardado sobrevive al resultado anterior", () => {
    const edited = { requirementId: "req-1", content: "c", base: "a", rev: 2, dirty: true };
    // El `saved` era del rev 1: no toca el contenido nuevo.
    expect(
      draftReducer(edited, { type: "saved", requirementId: "req-1", content: "b", rev: 1 }),
    ).toBe(edited);
    // Ni el de otro requisito.
    expect(
      draftReducer(edited, { type: "saved", requirementId: "req-9", content: "c", rev: 2 }),
    ).toBe(edited);
  });

  it("el descarte explícito resincroniza sin condiciones", () => {
    const dirty = { requirementId: "req-1", content: "mío", base: "v1", rev: 4, dirty: true };
    expect(
      draftReducer(dirty, { type: "discard", requirementId: "req-1", content: "v1" }),
    ).toEqual({ requirementId: "req-1", content: "v1", base: "v1", rev: 4, dirty: false });
  });

  it("cambiar de selección limpia el borrador", () => {
    const dirty = { requirementId: "req-1", content: "mío", base: "v1", rev: 3, dirty: true };
    expect(draftReducer(dirty, { type: "select", requirementId: "req-2" })).toEqual({
      requirementId: "req-2",
      content: "",
      base: "",
      rev: 0,
      dirty: false,
    });
  });
});

describe("reviewReducer", () => {
  it("confirmar fija la versión revisada y desmarcar la limpia", () => {
    const on = reviewReducer(
      EMPTY_REVIEW,
      { type: "toggle", versionId: "req-1-v2", checked: true },
    );
    expect(on.reviewedVersionId).toBe("req-1-v2");
    expect(
      reviewReducer(on, { type: "toggle", versionId: "req-1-v2", checked: false }),
    ).toEqual(EMPTY_REVIEW);
  });

  it("reset limpia la confirmación", () => {
    expect(reviewReducer({ reviewedVersionId: "req-1-v2" }, { type: "reset" })).toEqual(
      EMPTY_REVIEW,
    );
  });
});

describe("canApprove", () => {
  const base = {
    reviewedVersionId: "req-1-v2",
    currentVersionId: "req-1-v2",
    dirty: false,
    approver: "ana",
    busy: false,
  };

  it("permite aprobar con confirmación vigente y borrador limpio", () => {
    expect(canApprove(base)).toBe(true);
  });

  it("impide aprobar con cambios sin guardar", () => {
    expect(canApprove({ ...base, dirty: true })).toBe(false);
  });

  it("impide aprobar otra versión distinta de la confirmada", () => {
    expect(canApprove({ ...base, currentVersionId: "req-1-v3" })).toBe(false);
  });

  it("impide aprobar sin autor o mientras hay operación en curso", () => {
    expect(canApprove({ ...base, approver: "  " })).toBe(false);
    expect(canApprove({ ...base, busy: true })).toBe(false);
  });
});

describe("normalizeCoreError", () => {
  it("conserva kind estable y mensaje", () => {
    expect(normalizeCoreError({ kind: "stale_version", message: "cambió" })).toEqual({
      kind: "stale_version",
      message: "cambió",
    });
  });

  it("degrada formas desconocidas a unexpected", () => {
    expect(normalizeCoreError("boom")).toEqual({
      kind: "unexpected",
      message: "Error inesperado en la operación.",
    });
    expect(normalizeCoreError({ kind: 7 })).toEqual({
      kind: "unexpected",
      message: "Error inesperado en la operación.",
    });
  });
});

describe("selectores de detalle", () => {
  const detail = {
    artifact: { id: "req-1", projectId: "proy-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
    versions: [
      { id: "req-1-v1", number: 1, content: "a", provenance: { kind: "human", by: "ana" }, sources: [] },
      { id: "req-1-v2", number: 2, content: "b", provenance: { kind: "human", by: "ana" }, sources: [] },
    ],
    approvals: [{ versionId: "req-1-v1", approvedBy: "bruno", at: "2026-10-27" }],
    currentVersionId: "req-1-v2",
  };

  it("localiza la versión actual", () => {
    expect(currentVersion(detail)?.id).toBe("req-1-v2");
  });

  it("deriva aprobaciones por versión sin flags", () => {
    expect(approvalsForVersion(detail, "req-1-v1")).toHaveLength(1);
    expect(approvalsForVersion(detail, "req-1-v2")).toHaveLength(0);
  });
});

describe("saveState", () => {
  it("reposa sin selección", () => {
    expect(
      saveState({ hasSelection: false, saving: false, error: null, dirty: false }),
    ).toBe("idle");
  });

  it("distingue borrador local y guardado", () => {
    expect(
      saveState({ hasSelection: true, saving: false, error: null, dirty: true }),
    ).toBe("draft");
    expect(
      saveState({ hasSelection: true, saving: false, error: null, dirty: false }),
    ).toBe("saved");
  });

  it("guardando tiene prioridad sobre borrador y error", () => {
    expect(
      saveState({ hasSelection: true, saving: true, error: "x", dirty: true }),
    ).toBe("saving");
  });

  it("el error se muestra hasta el próximo intento", () => {
    expect(
      saveState({ hasSelection: true, saving: false, error: "fallo", dirty: true }),
    ).toBe("error");
  });
});

describe("resolveSaveTarget", () => {
  const base = {
    requirementId: "req-1",
    designId: "flujo-1",
    mockupId: "mock-1",
    requirementDirty: false,
    designDirty: false,
    designKeyOk: true,
    mockupDirty: false,
    mockupKeyOk: true,
  };

  it("dirige a cada editor con cambios y a ninguno sin cambios", () => {
    expect(
      resolveSaveTarget({ ...base, centerView: "requirements", requirementDirty: true }),
    ).toBe("requirement");
    expect(
      resolveSaveTarget({ ...base, centerView: "design", designDirty: true }),
    ).toBe("design");
    expect(
      resolveSaveTarget({ ...base, centerView: "mockups", mockupDirty: true }),
    ).toBe("mockup");
    expect(resolveSaveTarget({ ...base, centerView: "requirements" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "design" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "impact" })).toBeNull();
  });

  it("no guarda diseños separados ni sin selección", () => {
    expect(
      resolveSaveTarget({ ...base, centerView: "design", designDirty: true, designKeyOk: false }),
    ).toBeNull();
    expect(
      resolveSaveTarget({
        ...base,
        centerView: "design",
        designDirty: true,
        designId: null,
      }),
    ).toBeNull();
    expect(
      resolveSaveTarget({
        ...base,
        centerView: "mockups",
        mockupDirty: true,
        mockupKeyOk: false,
      }),
    ).toBeNull();
  });
});
