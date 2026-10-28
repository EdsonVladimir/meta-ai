import { describe, expect, it } from "vitest";
import {
  mockupDraftReducer,
  mockupLayoutDirty,
  mockupSemanticDirty,
  mockupSpec,
  needsMockupConfirm,
  type MockupDraftState,
} from "./mockupDraft";

const BASE = '{"screens":[]}';
const EDITED = '{"screens":[{"id":"s1"}]}';

function init(): MockupDraftState {
  const state = mockupDraftReducer(null, {
    type: "init",
    key: "m1:m1-v1",
    base: BASE,
    layout: { s1: { x: 0, y: 0 } },
    allowed: [],
    pins: [],
  });
  if (state === null) throw new Error("init devolvió null");
  return state;
}

describe("borrador de mockup", () => {
  it("init con la misma clave conserva el estado", () => {
    const first = init();
    const again = mockupDraftReducer(first, {
      type: "init",
      key: "m1:m1-v1",
      base: BASE,
      layout: {},
      allowed: [],
      pins: [],
    });
    expect(again).toBe(first);
  });

  it("editar marca sucio semántico; deshacer lo limpia", () => {
    let state: MockupDraftState | null = init();
    expect(mockupSemanticDirty(state)).toBe(false);
    state = mockupDraftReducer(state, { type: "apply", spec: EDITED });
    expect(mockupSemanticDirty(state)).toBe(true);
    expect(mockupSpec(state)).toBe(EDITED);
    state = mockupDraftReducer(state, { type: "undo" });
    expect(mockupSemanticDirty(state)).toBe(false);
    state = mockupDraftReducer(state, { type: "redo" });
    expect(mockupSemanticDirty(state)).toBe(true);
  });

  it("mover solo ensucia la disposición, nunca la semántica", () => {
    let state: MockupDraftState | null = init();
    state = mockupDraftReducer(state, { type: "move", id: "s1", x: 40, y: 10 });
    expect(mockupLayoutDirty(state)).toBe(true);
    expect(mockupSemanticDirty(state)).toBe(false);
    expect(mockupSpec(state)).toBe(BASE);
  });

  it("redimensionar solo ensucia la disposición", () => {
    let state: MockupDraftState | null = init();
    state = mockupDraftReducer(state, { type: "resize", id: "s1", w: 200, h: 120 });
    expect(mockupLayoutDirty(state)).toBe(true);
    expect(mockupSemanticDirty(state)).toBe(false);
  });

  it("mover a la misma posición no ensucia", () => {
    const state = mockupDraftReducer(init(), { type: "move", id: "s1", x: 0, y: 0 });
    expect(mockupLayoutDirty(state)).toBe(false);
  });

  it("guardar disposición limpia solo lo visual", () => {
    let state: MockupDraftState | null = init();
    state = mockupDraftReducer(state, { type: "move", id: "s1", x: 40, y: 10 });
    state = mockupDraftReducer(state, { type: "apply", spec: EDITED });
    if (state === null) throw new Error("edita");
    state = mockupDraftReducer(state, { type: "savedLayout", layout: state.layout });
    expect(mockupLayoutDirty(state)).toBe(false);
    expect(mockupSemanticDirty(state)).toBe(true);
  });

  it("el resultado tardío no limpia lo editado durante el guardado", () => {
    const fresh = init();
    expect(
      mockupDraftReducer(fresh, {
        type: "saved",
        present: fresh.history.present,
        pins: fresh.pins,
        allowed: fresh.allowed,
      }),
    ).toBeNull();
    let moved: MockupDraftState | null = init();
    moved = mockupDraftReducer(moved, { type: "apply", spec: EDITED });
    const kept = mockupDraftReducer(moved, {
      type: "saved",
      present: BASE,
      pins: [],
      allowed: [],
    });
    expect(kept).not.toBeNull();
    expect(mockupSemanticDirty(kept)).toBe(true);
  });

  it("renombrar reasigna la disposición sin ensuciar la semántica", () => {
    let state: MockupDraftState | null = init();
    state = mockupDraftReducer(state, { type: "move", id: "s1", x: 40, y: 10 });
    state = mockupDraftReducer(state, { type: "remap", oldId: "s1", newId: "s2" });
    if (state === null) throw new Error("remap devolvió null");
    expect(state.layout["s2"]).toEqual({ x: 40, y: 10 });
    expect(state.layout["s1"]).toBeUndefined();
    expect(mockupSemanticDirty(state)).toBe(false);
  });

  it("cambiar de selección limpia el borrador", () => {
    const state = mockupDraftReducer(init(), { type: "reset" });
    expect(state).toBeNull();
  });

  it("pide confirmación al abandonar con cambios, no al quedarse", () => {
    const clean = init();
    expect(needsMockupConfirm(clean, "m1", "m2")).toBe(false);
    expect(needsMockupConfirm(null, "m1", "m2")).toBe(false);
    const dirty = mockupDraftReducer(clean, { type: "apply", spec: EDITED });
    expect(needsMockupConfirm(dirty, "m1", "m2")).toBe(true);
    expect(needsMockupConfirm(dirty, "m1", "m1")).toBe(false);
    const moved = mockupDraftReducer(clean, { type: "move", id: "s1", x: 5, y: 5 });
    expect(needsMockupConfirm(moved, "m1", "m2")).toBe(true);
  });
});
