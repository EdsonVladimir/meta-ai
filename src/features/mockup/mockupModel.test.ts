// Pure tests for the mockup model and draft: parsing, canonical form,
// operations, orientative validation and semantic/layout separation.
import { describe, expect, it } from "vitest";
import {
  alignMoves,
  canonicalMockup,
  detectMockupRename,
  duplicateComponent,
  mockupSummary,
  newComponent,
  parentOf,
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

function booking(): MockupSpec {
  return {
    title: "New booking",
    screens: [
      {
        id: "new_booking",
        title: "New booking",
        requirements: ["req-1"],
        designs: [],
        states: [],
        components: [
          { id: "t1", kind: "text", text: "New booking", required: false, validations: [], options: [], columns: [], columnTypes: [], previewRows: [], rowActions: [], children: [], requirements: [], designs: [] },
          { id: "f_customer", kind: "field", label: "Customer", fieldType: "text", required: true, origin: "persisted", validations: [], options: [], columns: [], columnTypes: [], previewRows: [], rowActions: [], children: [], requirements: ["req-1"], designs: [] },
          { id: "b_ok", kind: "button", label: "Confirm", operation: "confirm_booking", required: false, validations: [], options: [], columns: [], columnTypes: [], previewRows: [], rowActions: [], children: [], requirements: [], designs: [] },
        ],
      },
    ],
  };
}

describe("parseMockupSpec", () => {
  it("parses the canonical form and revalidates it", () => {
    const parsed = parseMockupSpec(JSON.parse(canonicalMockup(booking())));
    expect(parsed).toEqual(booking());
  });

  it("rejects foreign shapes", () => {
    expect(parseMockupSpec(null)).toBeNull();
    expect(parseMockupSpec({})).toBeNull();
    expect(parseMockupSpec({ title: "x", screens: [{ id: "p" }] })).toBeNull();
    expect(
      parseMockupSpec({
        title: "x",
        screens: [{ id: "p", title: "P", requirements: [], designs: [], components: [{ id: "c", kind: "magic" }] }],
      }),
    ).toBeNull();
  });

  it("tolerates absences the canonical form omits", () => {
    const parsed = parseMockupSpec({
      title: "x",
      screens: [{ id: "p", title: "P", components: [{ id: "c", kind: "button", label: "B" }] }],
    });
    expect(parsed?.screens[0].requirements).toEqual([]);
    expect(parsed?.screens[0].states).toEqual([]);
    expect(parsed?.screens[0].components[0].options).toEqual([]);
    expect(parsed?.screens[0].components[0].children).toEqual([]);
    expect(parsed?.screens[0].components[0].required).toBe(false);
  });

  it("normalizes legacy content like Rust", () => {
    const parsed = parseMockupSpec({
      title: "x",
      screens: [
        {
          id: "p",
          title: "P",
          components: [
            { id: "f", kind: "field", label: "F", field_type: "text", validation: "letters only", origin: "temporary" },
            { id: "b", kind: "button", label: "B", action: "confirm" },
            { id: "n", kind: "button", label: "N", action: "submit" },
          ],
        },
      ],
    });
    expect(parsed?.screens[0].components[0].validations).toEqual(["letters only"]);
    expect(parsed?.screens[0].components[1].operation).toBe("confirm");
    expect(parsed?.screens[0].components[1].actionKind).toBeUndefined();
    expect(parsed?.screens[0].components[2].actionKind).toBe("submit");
    expect(parsed?.screens[0].components[2].operation).toBeUndefined();
  });

  it("normalizes default values", () => {
    const parsed = parseMockupSpec({
      title: "x",
      screens: [
        {
          id: "p",
          title: "P",
          components: [
            { id: "b", kind: "button", label: "B", button_state: "enabled" },
            { id: "g", kind: "container", label: "G", direction: "vertical" },
          ],
        },
      ],
    });
    expect(parsed?.screens[0].components[0].buttonState).toBeUndefined();
    expect(parsed?.screens[0].components[1].direction).toBeUndefined();
  });
});

describe("canonicalMockup", () => {
  it("omits empties in Rust order", () => {
    const canonical = canonicalMockup({
      title: "M",
      screens: [{ id: "p", title: "P", requirements: [], designs: [], states: [], components: [{ id: "c", kind: "button", label: "B", required: false, validations: [], options: [], columns: [], columnTypes: [], previewRows: [], rowActions: [], children: [], requirements: [], designs: [] }] }],
    });
    expect(canonical).toBe(
      '{"title":"M","kind":"mockup","screens":[{"id":"p","title":"P","components":[{"id":"c","kind":"button","label":"B"}]}]}',
    );
  });

  it("emits new keys in Rust order", () => {
    const canonical = canonicalMockup({
      title: "M",
      screens: [
        {
          id: "p",
          title: "P",
          requirements: [],
          designs: [],
          states: [{ id: "empty", label: "Empty" }],
          components: [
            {
              id: "f", kind: "field", label: "F", name: "f", fieldType: "text",
              required: true, validations: ["v"], dataRef: "req-1/x", options: [],
              columns: [], columnTypes: [], previewRows: [], rowActions: [],
              origin: "temporary", children: [], requirements: [], designs: [],
            },
            {
              id: "i", kind: "icon", label: "I", required: false, validations: [],
              options: [], columns: [], columnTypes: [], previewRows: [], rowActions: [],
              actionKind: "submit", operation: "send", buttonState: "disabled",
              icon: "save", iconRole: "button", tooltip: "T", children: [],
              requirements: [], designs: [],
            },
          ],
        },
      ],
    });
    const field = canonical.indexOf('"validations":["v"],"data_ref":"req-1/x"');
    expect(field).toBeGreaterThan(0);
    const order = ['"action_kind":"submit"', '"operation":"send"', '"button_state":"disabled"', '"icon":"save"', '"icon_role":"button"', '"tooltip":"T"'];
    let pos = 0;
    for (const key of order) {
      const next = canonical.indexOf(key, pos);
      expect(next).toBeGreaterThan(pos);
      pos = next;
    }
    expect(canonical).toContain('"states":[{"id":"empty","label":"Empty"}]');
  });

  it("serializes field_type with underscore", () => {
    const canonical = canonicalMockup(booking());
    expect(canonical).toContain('"field_type":"text"');
    expect(canonical).toContain('"origin":"persisted"');
  });
});

describe("operations", () => {
  it("screens: add, remove", () => {
    const added = addScreen(booking(), "other", "Other");
    expect(added.screens).toHaveLength(2);
    expect(removeScreen(added, "other").screens).toHaveLength(1);
    // Without mutating the original.
    expect(booking().screens).toHaveLength(1);
  });

  it("components: add, edit, remove", () => {
    const added = addComponent(booking(), "new_booking", newComponent("table", "tb"));
    expect(added.screens[0].components).toHaveLength(4);
    const edited = updateComponent(added, "new_booking", "tb", { label: "Lines" });
    expect(edited.screens[0].components[3].label).toBe("Lines");
    expect(removeComponent(edited, "new_booking", "tb").screens[0].components).toHaveLength(3);
  });

  it("renames components with uniqueness", () => {
    const renamed = renameComponentId(booking(), "new_booking", "t1", "title_c");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.spec.screens[0].components[0].id).toBe("title_c");
    }
    const dup = renameComponentId(booking(), "new_booking", "t1", "b_ok");
    expect(dup.ok).toBe(false);
    const bad = renameComponentId(booking(), "new_booking", "t1", "with spaces");
    expect(bad.ok).toBe(false);
  });

  it("renames screens following targets", () => {
    const spec = booking();
    spec.screens[0].components[2].target = "new_booking";
    const renamed = renameScreenId(spec, "new_booking", "booking");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.spec.screens[0].components[2].target).toBe("booking");
    }
  });

  it("deletes screens clearing targets and reporting", () => {
    const spec = booking();
    spec.screens.push({ ...spec.screens[0], id: "other", title: "Other", components: [] });
    spec.screens[1].components = [
      { id: "back", kind: "button", label: "Back", target: "new_booking", required: false, validations: [], options: [], columns: [], columnTypes: [], previewRows: [], rowActions: [], children: [], requirements: [], designs: [] },
    ];
    const { spec: next, cleared } = removeScreenClean(spec, "new_booking");
    expect(next.screens).toHaveLength(1);
    expect(cleared).toEqual(["other/back"]);
    expect(next.screens[0].components[0].target).toBeUndefined();
  });

  it("detects a single rename", () => {
    const before = booking();
    const renamed = renameComponentId(before, "new_booking", "t1", "title_c");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(detectMockupRename(before, renamed.spec)).toEqual(["t1", "title_c"]);
    }
    expect(detectMockupRename(before, before)).toBeNull();
    expect(detectMockupRename(before, addScreen(before, "x", "X"))).toBeNull();
  });

  it("suggests free identifiers", () => {
    const used = new Set(["field", "field_2"]);
    expect(suggestMockupId("field", used)).toBe("field_3");
    expect(suggestMockupId("new", used)).toBe("new");
  });

  it("summarizes screens and components", () => {
    expect(mockupSummary(booking())).toEqual({ screens: 1, components: 3 });
  });

  it("deleting releases the child from its container", () => {
    let spec = addComponent(booking(), "new_booking", newComponent("container", "g"));
    spec = updateComponent(spec, "new_booking", "g", { children: ["t1"] });
    expect(parentOf(spec, "new_booking", "t1")?.id).toBe("g");
    const next = removeComponent(spec, "new_booking", "t1");
    expect(next.screens[0].components.find((c) => c.id === "g")?.children).toEqual([]);
    expect(parentOf(next, "new_booking", "t1")).toBeNull();
  });

  it("duplicates with fresh identifiers", () => {
    const dup = duplicateComponent(booking(), "new_booking", "f_customer");
    expect(dup).not.toBeNull();
    expect(dup?.cloneId).toBe("f_customer_copy");
    expect(dup?.spec.screens[0].components).toHaveLength(4);
    const ids = dup?.spec.screens[0].components.map((c) => c.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("aligns and distributes only with enough boxes", () => {
    const boxes = [
      { id: "a", x: 10, y: 0, w: 10, h: 10 },
      { id: "b", x: 30, y: 50, w: 10, h: 10 },
      { id: "c", x: 90, y: 20, w: 10, h: 10 },
    ];
    expect(alignMoves(boxes, "left").map((m) => [m.id, m.x])).toEqual([["b", 10], ["c", 10]]);
    expect(alignMoves(boxes, "top").map((m) => [m.id, m.y])).toEqual([["b", 0], ["c", 0]]);
    // From 10 to 90 in 3 steps: the middle one goes to 50.
    expect(alignMoves(boxes, "distributeH")).toEqual([{ id: "b", x: 50, y: 50 }]);
    expect(alignMoves(boxes.slice(0, 1), "left")).toEqual([]);
    expect(alignMoves(boxes.slice(0, 2), "distributeH")).toEqual([]);
  });

  it("duplicates containers with their children", () => {
    let spec = addComponent(booking(), "new_booking", newComponent("container", "g"));
    spec = updateComponent(spec, "new_booking", "g", { children: ["t1"] });
    const dup = duplicateComponent(spec, "new_booking", "g");
    const clone = dup?.spec.screens[0].components.find((c) => c.id === dup?.cloneId);
    expect(clone?.children).toHaveLength(1);
    expect(clone?.children[0]).not.toBe("t1");
    expect(validateMockupOrientative(dup?.spec ?? booking(), ["req-1"])).toEqual([]);
  });
});

describe("validateMockupOrientative", () => {
  it("accepts the valid mockup", () => {
    expect(validateMockupOrientative(booking(), ["req-1"])).toEqual([]);
  });

  it("flags empty title, duplicates and targets", () => {
    const bad = booking();
    bad.title = "  ";
    bad.screens[0].components[1].id = "t1";
    bad.screens[0].components[2].target = "ghost";
    const errors = validateMockupOrientative(bad, ["req-1"]);
    expect(errors.some((e) => e.includes("title"))).toBe(true);
    expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    expect(errors.some((e) => e.includes("missing"))).toBe(true);
  });

  it("requires origin on field, selector and table", () => {
    const spec = booking();
    delete spec.screens[0].components[1].origin;
    spec.screens[0].components.push(newComponent("selector", "s1"));
    delete spec.screens[0].components[3].origin;
    const errors = validateMockupOrientative(spec, ["req-1"]);
    expect(errors.filter((e) => e.includes("origin"))).toHaveLength(2);
  });

  it("rejects references outside the sources", () => {
    const errors = validateMockupOrientative(booking(), []);
    expect(errors.some((e) => e.includes("req-1"))).toBe(true);
  });

  it("validates the artifact/element shape", () => {
    const spec = booking();
    spec.screens[0].components[0].designs = ["no-slash"];
    spec.screens[0].requirements = [];
    spec.screens[0].components[1].requirements = [];
    const errors = validateMockupOrientative(spec, ["flow-1"]);
    expect(errors.some((e) => e.includes("artifact/element"))).toBe(true);
  });

  it("validates containers, icons and states", () => {
    let spec = addComponent(booking(), "new_booking", newComponent("container", "g"));
    spec = updateComponent(spec, "new_booking", "g", { children: ["nobody"] });
    spec = addComponent(spec, "new_booking", { ...newComponent("icon", "i"), icon: "plane" });
    spec = {
      ...spec,
      screens: spec.screens.map((s) => ({ ...s, states: [{ id: "a", label: "" }] })),
    };
    const errors = validateMockupOrientative(spec, ["req-1"]);
    expect(errors.some((e) => e.includes("missing"))).toBe(true);
    expect(errors.some((e) => e.includes("catalog"))).toBe(true);
    expect(errors.some((e) => e.includes("empty label"))).toBe(true);
  });

  it("validates data references and per-action targets", () => {
    const spec = booking();
    spec.screens[0].components[1].dataRef = "other/x";
    spec.screens[0].components[2].target = "dlg_help";
    spec.screens[0].components[2].actionKind = "open_dialog";
    const errors = validateMockupOrientative(spec, ["req-1"]);
    expect(errors.some((e) => e.includes("sources"))).toBe(true);
    // With open_dialog the opaque target needs no existing screen.
    expect(errors.some((e) => e.includes("missing"))).toBe(false);
  });

  it("requires one type per column and bounded rows", () => {
    let spec = addComponent(booking(), "new_booking", newComponent("table", "tb"));
    spec = updateComponent(spec, "new_booking", "tb", {
      columns: ["a", "b"],
      columnTypes: ["text"],
      previewRows: [["x", "y", "z"]],
    });
    const errors = validateMockupOrientative(spec, ["req-1"]);
    expect(errors.some((e) => e.includes("one type per column"))).toBe(true);
    expect(errors.some((e) => e.includes("more cells"))).toBe(true);
  });
});

describe("mockupDraftReducer", () => {
  const base = canonicalMockup(booking());

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

  it("starts clean and applies semantic changes", () => {
    const state = init();
    expect(mockupSemanticDirty(state)).toBe(false);
    expect(mockupLayoutDirty(state)).toBe(false);
    const changed = mockupDraftReducer(state, {
      type: "apply",
      spec: canonicalMockup({ ...booking(), title: "Other" }),
    });
    expect(mockupSemanticDirty(changed)).toBe(true);
    expect(mockupLayoutDirty(changed)).toBe(false);
    // Undo returns to the base.
    expect(mockupSemanticDirty(mockupDraftReducer(changed, { type: "undo" }))).toBe(false);
  });

  it("moving and resizing only dirty the layout", () => {
    const moved = mockupDraftReducer(init(), { type: "move", id: "t1", x: 10, y: 20 });
    expect(mockupSemanticDirty(moved)).toBe(false);
    expect(mockupLayoutDirty(moved)).toBe(true);
    const resized = mockupDraftReducer(init(), { type: "resize", id: "t1", w: 100, h: 50 });
    expect(mockupSemanticDirty(resized)).toBe(false);
    expect(mockupLayoutDirty(resized)).toBe(true);
    // Moving to the same spot does not dirty.
    expect(mockupLayoutDirty(mockupDraftReducer(init(), { type: "move", id: "t1", x: 0, y: 0 }))).toBe(false);
  });

  it("remap carries the layout over on rename", () => {
    const remapped = mockupDraftReducer(init(), { type: "remap", oldId: "t1", newId: "title_c" });
    expect(remapped?.layout["title_c"]).toEqual({ x: 0, y: 0 });
    expect(remapped?.layout["t1"]).toBeUndefined();
  });

  it("asks to confirm when leaving with changes", () => {
    const dirty = mockupDraftReducer(init(), { type: "apply", spec: base + " " });
    expect(needsMockupConfirm(dirty, "mockup-1", "mockup-2")).toBe(true);
    expect(needsMockupConfirm(dirty, "mockup-1", "mockup-1")).toBe(false);
    expect(needsMockupConfirm(init(), "mockup-1", "mockup-2")).toBe(false);
    expect(needsMockupConfirm(null, "mockup-1", "mockup-2")).toBe(false);
  });
});
