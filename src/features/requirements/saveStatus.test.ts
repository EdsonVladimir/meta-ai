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

describe("header save state", () => {
  it("without an active document reports none and counts the rest", () => {
    const status = {
      [docKey("req", "r1")]: doc({ dirty: true }),
      [docKey("design", "d1")]: doc({ dirty: true }),
    };
    expect(headerSave(status, null)).toEqual({ state: "none", othersDirty: 2, error: null });
  });

  it("the active one rules: saving, error, dirty, saved", () => {
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

  it("the rest do not pollute the active one", () => {
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

  it("derives the document from selection and view", () => {
    const selection = {
      projectId: "p",
      moduleId: "m",
      requirementId: "r1",
      designId: "d1",
      mockupId: null,
      screenId: null,
    };
    expect(activeDocKey(selection, "requirements")).toBe("req:r1");
    expect(activeDocKey(selection, "design")).toBe("design:d1");
    expect(activeDocKey(selection, "mockups")).toBeNull();
    expect(activeDocKey(selection, "impact")).toBeNull();
    expect(activeDocKey(selection, "traceability")).toBeNull();
  });

  it("with a document open, the active tab rules", () => {
    const selection = {
      projectId: "p",
      moduleId: "m",
      requirementId: "r1",
      designId: null,
      mockupId: null,
      screenId: null,
    };
    expect(activeDocKey(selection, "overview", "root-1::a.ts")).toBe("code:root-1::a.ts");
    expect(activeDocKey(selection, "overview", null)).toBeNull();
  });
});
