// Pruebas puras del modelo y el borrador de mockups: parseo, canónico,
// operaciones, validación orientativa y separación semántica/disposición.
import { describe, expect, it } from "vitest";
import {
  canonicalMockup,
  detectMockupRename,
  mockupSummary,
  newComponent,
  parseMockupSpec,
  suggestMockupId,
  validateMockupOrientative,
  addComponent,
  addScreen,
  removeComponent,
  removeScreen,
  removeScreenClean,
  renameComponentId,
  renameScreenId,
  updateComponent,
  type MockupSpec,
} from "./mockupModel";
import {
  mockupDraftReducer,
  mockupLayoutDirty,
  mockupSemanticDirty,
  needsMockupConfirm,
} from "./mockupDraft";

function reserva(): MockupSpec {
  return {
    title: "Nueva reserva",
    screens: [
      {
        id: "nueva_reserva",
        title: "Nueva reserva",
        requirements: ["req-1"],
        designs: [],
        components: [
          { id: "t1", kind: "text", text: "Nueva reserva", required: false, options: [], columns: [], requirements: [], designs: [] },
          { id: "f_cliente", kind: "field", label: "Cliente", fieldType: "text", required: true, origin: "persisted", options: [], columns: [], requirements: ["req-1"], designs: [] },
          { id: "b_ok", kind: "button", label: "Confirmar", action: "confirmar_reserva", required: false, options: [], columns: [], requirements: [], designs: [] },
        ],
      },
    ],
  };
}

describe("parseMockupSpec", () => {
  it("parsea el canónico y lo revalida", () => {
    const parsed = parseMockupSpec(JSON.parse(canonicalMockup(reserva())));
    expect(parsed).toEqual(reserva());
  });

  it("rechaza formas ajenas", () => {
    expect(parseMockupSpec(null)).toBeNull();
    expect(parseMockupSpec({})).toBeNull();
    expect(parseMockupSpec({ title: "x", screens: [{ id: "p" }] })).toBeNull();
    expect(
      parseMockupSpec({
        title: "x",
        screens: [{ id: "p", title: "P", requirements: [], designs: [], components: [{ id: "c", kind: "magia" }] }],
      }),
    ).toBeNull();
  });

  it("tolera ausencias que el canónico omite", () => {
    const parsed = parseMockupSpec({
      title: "x",
      screens: [{ id: "p", title: "P", components: [{ id: "c", kind: "button", label: "B" }] }],
    });
    expect(parsed?.screens[0].requirements).toEqual([]);
    expect(parsed?.screens[0].components[0].options).toEqual([]);
    expect(parsed?.screens[0].components[0].required).toBe(false);
  });
});

describe("canonicalMockup", () => {
  it("omite vacíos con el orden de Rust", () => {
    const canonical = canonicalMockup({
      title: "M",
      screens: [{ id: "p", title: "P", requirements: [], designs: [], components: [{ id: "c", kind: "button", label: "B", required: false, options: [], columns: [], requirements: [], designs: [] }] }],
    });
    expect(canonical).toBe(
      '{"title":"M","kind":"mockup","screens":[{"id":"p","title":"P","components":[{"id":"c","kind":"button","label":"B"}]}]}',
    );
  });

  it("serializa field_type con guion bajo", () => {
    const canonical = canonicalMockup(reserva());
    expect(canonical).toContain('"field_type":"text"');
    expect(canonical).toContain('"origin":"persisted"');
  });
});

describe("operaciones", () => {
  it("pantallas: añadir, quitar", () => {
    const added = addScreen(reserva(), "otra", "Otra");
    expect(added.screens).toHaveLength(2);
    expect(removeScreen(added, "otra").screens).toHaveLength(1);
    // Sin mutar el original.
    expect(reserva().screens).toHaveLength(1);
  });

  it("componentes: añadir, editar, quitar", () => {
    const added = addComponent(reserva(), "nueva_reserva", newComponent("table", "tb"));
    expect(added.screens[0].components).toHaveLength(4);
    const edited = updateComponent(added, "nueva_reserva", "tb", { label: "Líneas" });
    expect(edited.screens[0].components[3].label).toBe("Líneas");
    expect(removeComponent(edited, "nueva_reserva", "tb").screens[0].components).toHaveLength(3);
  });

  it("renombra componentes con unicidad", () => {
    const renamed = renameComponentId(reserva(), "nueva_reserva", "t1", "titulo");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.spec.screens[0].components[0].id).toBe("titulo");
    }
    const dup = renameComponentId(reserva(), "nueva_reserva", "t1", "b_ok");
    expect(dup.ok).toBe(false);
    const bad = renameComponentId(reserva(), "nueva_reserva", "t1", "con espacios");
    expect(bad.ok).toBe(false);
  });

  it("renombra pantallas siguiendo los destinos", () => {
    const spec = reserva();
    spec.screens[0].components[2].target = "nueva_reserva";
    const renamed = renameScreenId(spec, "nueva_reserva", "reserva");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.spec.screens[0].components[2].target).toBe("reserva");
    }
  });

  it("borra pantallas limpiando destinos y avisando", () => {
    const spec = reserva();
    spec.screens.push({ ...spec.screens[0], id: "otra", title: "Otra", components: [] });
    spec.screens[1].components = [
      { id: "volver", kind: "button", label: "Volver", target: "nueva_reserva", required: false, options: [], columns: [], requirements: [], designs: [] },
    ];
    const { spec: next, cleared } = removeScreenClean(spec, "nueva_reserva");
    expect(next.screens).toHaveLength(1);
    expect(cleared).toEqual(["otra/volver"]);
    expect(next.screens[0].components[0].target).toBeUndefined();
  });

  it("detecta un renombrado único", () => {
    const before = reserva();
    const renamed = renameComponentId(before, "nueva_reserva", "t1", "titulo");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(detectMockupRename(before, renamed.spec)).toEqual(["t1", "titulo"]);
    }
    expect(detectMockupRename(before, before)).toBeNull();
    expect(detectMockupRename(before, addScreen(before, "x", "X"))).toBeNull();
  });

  it("sugiere identificadores libres", () => {
    const used = new Set(["campo", "campo_2"]);
    expect(suggestMockupId("campo", used)).toBe("campo_3");
    expect(suggestMockupId("nuevo", used)).toBe("nuevo");
  });

  it("resume pantallas y componentes", () => {
    expect(mockupSummary(reserva())).toEqual({ screens: 1, components: 3 });
  });
});

describe("validateMockupOrientative", () => {
  it("acepta el mockup válido", () => {
    expect(validateMockupOrientative(reserva(), ["req-1"])).toEqual([]);
  });

  it("señala título vacío, duplicados y destinos", () => {
    const bad = reserva();
    bad.title = "  ";
    bad.screens[0].components[1].id = "t1";
    bad.screens[0].components[2].target = "fantasma";
    const errors = validateMockupOrientative(bad, ["req-1"]);
    expect(errors.some((e) => e.includes("título"))).toBe(true);
    expect(errors.some((e) => e.includes("duplicado"))).toBe(true);
    expect(errors.some((e) => e.includes("inexistente"))).toBe(true);
  });

  it("exige origen en campo, selector y tabla", () => {
    const spec = reserva();
    delete spec.screens[0].components[1].origin;
    spec.screens[0].components.push(newComponent("selector", "s1"));
    delete spec.screens[0].components[3].origin;
    const errors = validateMockupOrientative(spec, ["req-1"]);
    expect(errors.filter((e) => e.includes("origen"))).toHaveLength(2);
  });

  it("rechaza referencias fuera de las fuentes", () => {
    const errors = validateMockupOrientative(reserva(), []);
    expect(errors.some((e) => e.includes("req-1"))).toBe(true);
  });

  it("valida la forma artefacto/elemento", () => {
    const spec = reserva();
    spec.screens[0].components[0].designs = ["sin-barra"];
    spec.screens[0].requirements = [];
    spec.screens[0].components[1].requirements = [];
    const errors = validateMockupOrientative(spec, ["flujo-1"]);
    expect(errors.some((e) => e.includes("artefacto/elemento"))).toBe(true);
  });
});

describe("mockupDraftReducer", () => {
  const base = canonicalMockup(reserva());

  function init() {
    return mockupDraftReducer(null, {
      type: "init",
      key: "mockup-1:mockup-1-v1",
      base,
      layout: { t1: { x: 0, y: 0 } },
      allowed: ["req-1"],
      pins: ["req-1-v1"],
    });
  }

  it("inicia limpio y aplica cambios semánticos", () => {
    const state = init();
    expect(mockupSemanticDirty(state)).toBe(false);
    expect(mockupLayoutDirty(state)).toBe(false);
    const changed = mockupDraftReducer(state, {
      type: "apply",
      spec: canonicalMockup({ ...reserva(), title: "Otro" }),
    });
    expect(mockupSemanticDirty(changed)).toBe(true);
    expect(mockupLayoutDirty(changed)).toBe(false);
    // Deshacer vuelve a la base.
    expect(mockupSemanticDirty(mockupDraftReducer(changed, { type: "undo" }))).toBe(false);
  });

  it("mover y redimensionar solo ensucian la disposición", () => {
    const moved = mockupDraftReducer(init(), { type: "move", id: "t1", x: 10, y: 20 });
    expect(mockupSemanticDirty(moved)).toBe(false);
    expect(mockupLayoutDirty(moved)).toBe(true);
    const resized = mockupDraftReducer(init(), { type: "resize", id: "t1", w: 100, h: 50 });
    expect(mockupSemanticDirty(resized)).toBe(false);
    expect(mockupLayoutDirty(resized)).toBe(true);
    // Mover al mismo sitio no ensucia.
    expect(mockupLayoutDirty(mockupDraftReducer(init(), { type: "move", id: "t1", x: 0, y: 0 }))).toBe(false);
  });

  it("remap traslada la disposición al renombrar", () => {
    const remapped = mockupDraftReducer(init(), { type: "remap", oldId: "t1", newId: "titulo" });
    expect(remapped?.layout["titulo"]).toEqual({ x: 0, y: 0 });
    expect(remapped?.layout["t1"]).toBeUndefined();
  });

  it("pide confirmar al abandonar con cambios", () => {
    const dirty = mockupDraftReducer(init(), { type: "apply", spec: base + " " });
    expect(needsMockupConfirm(dirty, "mockup-1", "mockup-2")).toBe(true);
    expect(needsMockupConfirm(dirty, "mockup-1", "mockup-1")).toBe(false);
    expect(needsMockupConfirm(init(), "mockup-1", "mockup-2")).toBe(false);
    expect(needsMockupConfirm(null, "mockup-1", "mockup-2")).toBe(false);
  });
});
