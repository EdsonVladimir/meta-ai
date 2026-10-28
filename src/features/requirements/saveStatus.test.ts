import { describe, expect, it } from "vitest";
import {
  activeDocKey,
  dirtyDocKeys,
  docKey,
  headerSave,
} from "./saveStatus";
import type { DocSaveState } from "./uiStore";

function doc(partial: Partial<DocSaveState> = {}): DocSaveState {
  return { label: "x", dirty: false, saving: false, error: null, ...partial };
}

describe("estado de guardado del encabezado", () => {
  it("sin documento activo informa none y cuenta los demás", () => {
    const status = {
      [docKey("req", "r1")]: doc({ dirty: true }),
      [docKey("design", "d1")]: doc({ dirty: true }),
    };
    expect(headerSave(status, null)).toEqual({ state: "none", othersDirty: 2, error: null });
  });

  it("el activo manda: guardando, error, pendiente, guardado", () => {
    expect(headerSave({ a: doc({ saving: true, dirty: true }) }, "a").state).toBe("saving");
    expect(headerSave({ a: doc({ error: "boom", dirty: true }) }, "a")).toEqual({
      state: "error",
      othersDirty: 0,
      error: "boom",
    });
    expect(headerSave({ a: doc({ dirty: true }) }, "a").state).toBe("dirty");
    expect(headerSave({ a: doc() }, "a").state).toBe("saved");
    expect(headerSave({}, "a").state).toBe("saved");
  });

  it("los demás no contaminan al activo", () => {
    const status = {
      [docKey("req", "r1")]: doc(),
      [docKey("design", "d1")]: doc({ dirty: true }),
      [docKey("mockup", "m1")]: doc({ dirty: true }),
    };
    expect(headerSave(status, docKey("req", "r1"))).toEqual({
      state: "saved",
      othersDirty: 2,
      error: null,
    });
    expect(dirtyDocKeys(status)).toEqual([docKey("design", "d1"), docKey("mockup", "m1")]);
  });

  it("deriva el documento de la selección y la vista", () => {
    const selection = {
      projectId: "p",
      moduleId: "m",
      requirementId: "r1",
      designId: "d1",
      mockupId: null,
    };
    expect(activeDocKey(selection, "requirements")).toBe("req:r1");
    expect(activeDocKey(selection, "design")).toBe("design:d1");
    expect(activeDocKey(selection, "mockups")).toBeNull();
    expect(activeDocKey(selection, "impact")).toBeNull();
  });
});
