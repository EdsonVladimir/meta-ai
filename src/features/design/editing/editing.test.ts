// Visual editor: adapters, operations, validation and history. Pure
// and deterministic; the canvas (React Flow) is verified separately.
import { describe, expect, test } from "vitest";
import {
  addAttribute,
  addEntity,
  addFlowEdge,
  addFlowNode,
  addRelation,
  artifactOfVersion,
  decisionBranchHandles,
  detectRename,
  erDeleteConsequences,
  erToGraph,
  flowDeleteConsequences,
  flowToGraph,
  parseErSpec,
  parseFlowSpec,
  parseLayout,
  remapLayout,
  removeAttribute,
  removeEntity,
  removeFlowEdge,
  removeFlowNode,
  removeRelation,
  renameAttribute,
  renameEntity,
  renameFlowNodeId,
  serializeErSpec,
  serializeFlowSpec,
  setAttributeKey,
  suggestId,
  updateFlowEdge,
  updateFlowNode,
  updateMeta,
  updateRelation,
  type DesignMeta,
  type ErSpec,
  type FlowSpec,
} from "./specModel";
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, undoHistory } from "./specHistory";
import { validateDraft } from "./specValidation";
import {
  needsVisualConfirm,
  visualDraftReducer,
  visualLayoutDirty,
  visualSemanticDirty,
  type VisualDraftState,
} from "./visualDraft";

const META: DesignMeta = { title: "Design", explanation: "Explanation.", questions: [] };

const FLOW: FlowSpec = {
  nodes: [
    { id: "start", kind: "start", label: "Start", requirements: ["req-1"], mockups: [] },
    { id: "end", kind: "end", label: "End", requirements: [], mockups: [] },
  ],
  edges: [{ from: "start", to: "end" }],
};

const ER: ErSpec = {
  entities: [
    {
      name: "Venta",
      attributes: [
        { name: "id", key: true },
        { name: "total", key: false },
      ],
      requirements: ["req-1"], mockups: [],
    },
  ],
  relations: [],
};

describe("parsing and serialization", () => {
  test("flow: round trip without semantic loss", () => {
    const canonical = serializeFlowSpec(FLOW, META);
    expect(canonical).toContain('"kind":"flow"');
    const parsed = parseFlowSpec(JSON.parse(canonical));
    expect(parsed).not.toBeNull();
    expect(parsed?.spec).toEqual(FLOW);
    expect(parsed?.meta).toEqual(META);
    expect(serializeFlowSpec(parsed!.spec, parsed!.meta)).toBe(canonical);
  });

  test("mockup citations survive the round trip", () => {
    const cited: FlowSpec = {
      ...FLOW,
      nodes: FLOW.nodes.map((n, i) => (i === 0 ? { ...n, mockups: ["mockup-1/f_name"] } : n)),
    };
    const canonical = serializeFlowSpec(cited, META);
    expect(canonical).toContain('"mockups":["mockup-1/f_name"]');
    expect(parseFlowSpec(JSON.parse(canonical))?.spec).toEqual(cited);
    // Empties are omitted like in Rust: the previous canonical form is unchanged.
    expect(serializeFlowSpec(FLOW, META)).not.toContain("mockups");
    const citedEr: ErSpec = {
      ...ER,
      entities: ER.entities.map((e) => ({ ...e, mockups: ["mockup-1/tb"] })),
    };
    const erCanonical = serializeErSpec(citedEr, META);
    expect(erCanonical).toContain('"mockups":["mockup-1/tb"]');
    expect(parseErSpec(JSON.parse(erCanonical))?.spec).toEqual(citedEr);
    // Older content without the key: tolerated as empty.
    const legacy = JSON.parse(serializeFlowSpec(FLOW, META));
    expect(parseFlowSpec(legacy)?.spec.nodes[0].mockups).toEqual([]);
  });

  test("ER: round trip without semantic loss", () => {
    const canonical = serializeErSpec(ER, META);
    expect(canonical).toContain('"kind":"data_model"');
    const parsed = parseErSpec(JSON.parse(canonical));
    expect(parsed?.spec).toEqual(ER);
    expect(serializeErSpec(parsed!.spec, parsed!.meta)).toBe(canonical);
    // Cardinalities travel in snake_case.
    const withRelation: ErSpec = {
      ...ER,
      relations: [{ from: "Venta", to: "Venta", fromCard: "1", toCard: "N" }],
    };
    const rel = serializeErSpec(withRelation, META);
    expect(rel).toContain('"from_card":"1"');
    expect(rel).toContain('"to_card":"N"');
    expect(parseErSpec(JSON.parse(rel))?.spec).toEqual(withRelation);
  });

  test("foreign shapes are rejected", () => {
    expect(parseFlowSpec(null)).toBeNull();
    expect(parseFlowSpec({})).toBeNull();
    expect(parseFlowSpec({ title: "x", explanation: "y", questions: [], nodes: {}, edges: [] })).toBeNull();
    expect(parseFlowSpec({ title: "x", explanation: "y", questions: [], nodes: [{ id: 1 }], edges: [] })).toBeNull();
    expect(parseErSpec({ title: "x", explanation: "y", questions: [], entities: [], relations: [] })).not.toBeNull();
    expect(parseErSpec({ title: "x", explanation: "y", questions: "no", entities: [], relations: [] })).toBeNull();
  });

  test("tolerant layout: only valid positions", () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout({ a: { x: 1, y: 2 }, b: { x: "bad" }, "": { x: 0, y: 0 } })).toEqual({
      a: { x: 1, y: 2 },
    });
  });
});

describe("canvas adapters", () => {
  test("the saved layout wins; the rest uses auto layout", () => {
    const { nodes, edges } = flowToGraph(FLOW, { end: { x: 500, y: 500 } });
    expect(nodes.find((n) => n.id === "end")).toMatchObject({ x: 500, y: 500 });
    expect(nodes.find((n) => n.id === "start")).toMatchObject({ x: 60, y: 60 });
    expect(edges).toEqual([{ id: "e0", from: "start", to: "end" }]);
    // Layers follow the connection direction.
    expect(nodes.find((n) => n.id === "end")!.x).toBeGreaterThan(
      nodes.find((n) => n.id === "start")!.x - 500,
    );
  });

  test("auto layout is deterministic and cycle-safe", () => {
    const cyclic: FlowSpec = {
      nodes: [
        { id: "a", kind: "step", label: "A", requirements: [], mockups: [] },
        { id: "b", kind: "step", label: "B", requirements: [], mockups: [] },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const first = flowToGraph(cyclic, {});
    const second = flowToGraph(cyclic, {});
    expect(first).toEqual(second);
    expect(first.nodes).toHaveLength(2);
  });

  test("ER uses a stable grid in spec order", () => {
    const spec: ErSpec = {
      entities: [
        { name: "B", attributes: [{ name: "id", key: true }], requirements: [], mockups: [] },
        { name: "A", attributes: [{ name: "id", key: true }], requirements: [], mockups: [] },
      ],
      relations: [],
    };
    const { nodes } = erToGraph(spec, {});
    expect(nodes[0].id).toBe("B");
    expect(nodes[0]).toMatchObject({ x: 60, y: 60 });
    expect(erToGraph(spec, {})).toEqual(erToGraph(spec, {}));
  });

  test("renaming relocates the saved position", () => {
    expect(remapLayout({ a: { x: 1, y: 1 } }, "a", "b")).toEqual({ b: { x: 1, y: 1 } });
    expect(remapLayout({ a: { x: 1, y: 1 } }, "a", "a")).toEqual({ a: { x: 1, y: 1 } });
  });

  test("detects single renames and ignores additions and removals", () => {
    const renamed = renameFlowNodeId(FLOW, "start", "launch").spec;
    expect(detectRename("flow", FLOW, renamed)).toEqual(["start", "launch"]);
    expect(detectRename("flow", FLOW, addFlowNode(FLOW, "step").spec)).toBeNull();
    expect(detectRename("flow", FLOW, FLOW)).toBeNull();
    const renamedEr = renameEntity(ER, "Venta", "Ticket").spec;
    expect(detectRename("data_model", ER, renamedEr)).toEqual(["Venta", "Ticket"]);
  });

  test("derives artifacts from known-shape versions", () => {
    expect(artifactOfVersion("req-1-v2")).toBe("req-1");
    expect(artifactOfVersion("flujo-1-v10")).toBe("flujo-1");
    expect(artifactOfVersion("odd")).toBeNull();
    expect(artifactOfVersion("")).toBeNull();
  });

  test("decision branches exit right, left and bottom", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "d", kind: "decision", label: "Stock?", requirements: [], mockups: [] },
        { id: "a", kind: "step", label: "A", requirements: [], mockups: [] },
        { id: "b", kind: "step", label: "B", requirements: [], mockups: [] },
        { id: "c", kind: "step", label: "C", requirements: [], mockups: [] },
      ],
      edges: [
        { from: "d", to: "a", label: "Yes" },
        { from: "d", to: "b", label: "No" },
        { from: "d", to: "c" },
        { from: "a", to: "b" },
      ],
    };
    expect(decisionBranchHandles(spec)).toEqual(["right", "left", "bottom", null]);
  });

  test("a decision with a single branch exits at the bottom", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "d", kind: "decision", label: "Continue?", requirements: [], mockups: [] },
        { id: "a", kind: "step", label: "A", requirements: [], mockups: [] },
      ],
      edges: [{ from: "d", to: "a" }],
    };
    expect(decisionBranchHandles(spec)).toEqual(["bottom"]);
  });

  test("each decision distributes its own branches without interference", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "d1", kind: "decision", label: "One", requirements: [], mockups: [] },
        { id: "d2", kind: "decision", label: "Two", requirements: [], mockups: [] },
        { id: "a", kind: "step", label: "A", requirements: [], mockups: [] },
        { id: "b", kind: "step", label: "B", requirements: [], mockups: [] },
      ],
      edges: [
        { from: "d1", to: "a" },
        { from: "d2", to: "a" },
        { from: "d2", to: "b" },
      ],
    };
    expect(decisionBranchHandles(spec)).toEqual(["bottom", "right", "left"]);
  });
});

describe("flow operations", () => {
  test("adding nodes generates free identities", () => {
    const first = addFlowNode(FLOW, "step");
    expect(first.id).toBe("step");
    const second = addFlowNode(first.spec, "step");
    expect(second.id).toBe("step_2");
    expect(second.spec.nodes).toHaveLength(4);
    expect(FLOW.nodes).toHaveLength(2);
  });

  test("editing label, kind and citations", () => {
    const next = updateFlowNode(FLOW, "end", { label: "Closure", kind: "step", requirements: ["req-2"], mockups: [] });
    expect(next.nodes[1]).toMatchObject({ label: "Closure", kind: "step", requirements: ["req-2"], mockups: [] });
  });

  test("renaming identity rewrites edges", () => {
    const renamed = renameFlowNodeId(FLOW, "start", "launch");
    expect(renamed.ok).toBe(true);
    expect(renamed.spec.edges).toEqual([{ from: "launch", to: "end" }]);
  });

  test("renaming rejects duplicates and invalid ids without mutating", () => {
    expect(renameFlowNodeId(FLOW, "start", "end")).toMatchObject({ ok: false });
    expect(renameFlowNodeId(FLOW, "start", "with spaces")).toMatchObject({ ok: false });
    expect(renameFlowNodeId(FLOW, "start", "")).toMatchObject({ ok: false });
    const rejected = renameFlowNodeId(FLOW, "start", "end");
    expect(rejected.spec).toBe(FLOW);
  });

  test("deleting a node reports fallen connections", () => {
    const removed = removeFlowNode(FLOW, "start");
    expect(removed.spec.nodes.map((n) => n.id)).toEqual(["end"]);
    expect(removed.removedEdges).toBe(1);
    expect(flowDeleteConsequences(FLOW, "start")).toEqual([
      "Deletes node \"start\".",
      "Deletes 1 connection touching it.",
      "Its citations disappear with it (requirements and mockups unchanged).",
    ]);
  });

  test("connections: create, label and delete", () => {
    const added = addFlowEdge(FLOW, "end", "start");
    expect(added.index).toBe(1);
    const labeled = updateFlowEdge(added.spec, 1, "retry");
    expect(labeled.edges[1]).toMatchObject({ label: "retry" });
    const cleared = updateFlowEdge(labeled, 1, null);
    expect(cleared.edges[1]).toEqual({ from: "end", to: "start" });
    expect(removeFlowEdge(cleared, 0).edges).toHaveLength(1);
  });

  test("suggestId skips taken ids", () => {
    expect(suggestId("step", new Set(["step", "step_2"]))).toBe("step_3");
    expect(suggestId("", new Set())).toBe("element");
  });
});

describe("ER operations", () => {
  test("adding an entity brings an initial attribute", () => {
    const added = addEntity(ER);
    expect(added.name).toBe("Entity");
    const entity = added.spec.entities.find((e) => e.name === "Entity");
    expect(entity?.attributes).toHaveLength(1);
  });

  test("renaming an entity rewrites relations", () => {
    const spec: ErSpec = {
      ...ER,
      entities: [...ER.entities, { name: "Linea", attributes: [{ name: "id", key: true }], requirements: [], mockups: [] }],
      relations: [{ from: "Venta", to: "Linea", fromCard: "1", toCard: "0..N" }],
    };
    const renamed = renameEntity(spec, "Venta", "Ticket");
    expect(renamed.ok).toBe(true);
    expect(renamed.spec.relations[0]).toMatchObject({ from: "Ticket" });
    expect(renameEntity(spec, "Venta", "Linea").ok).toBe(false);
  });

  test("deleting an entity reports attributes and relations", () => {
    const spec: ErSpec = {
      ...ER,
      entities: [...ER.entities, { name: "Linea", attributes: [{ name: "id", key: true }], requirements: [], mockups: [] }],
      relations: [{ from: "Venta", to: "Linea", fromCard: "1", toCard: "0..N" }],
    };
    const removed = removeEntity(spec, "Venta");
    expect(removed.removedAttributes).toBe(2);
    expect(removed.removedRelations).toBe(1);
    expect(erDeleteConsequences(spec, "Venta")).toContain("Deletes 2 attributes.");
  });

  test("attributes: add, rename, key and delete", () => {
    const added = addAttribute(ER, "Venta");
    expect(added.name).toBe("attribute");
    const renamed = renameAttribute(added.spec, "Venta", "attribute", "codigo");
    expect(renamed.ok).toBe(true);
    expect(renameAttribute(renamed.spec, "Venta", "codigo", "id").ok).toBe(false);
    const keyed = setAttributeKey(renamed.spec, "Venta", "codigo", true);
    expect(keyed.entities[0].attributes.find((a) => a.name === "codigo")?.key).toBe(true);
    const removed = removeAttribute(keyed, "Venta", "codigo");
    expect(removed.entities[0].attributes.map((a) => a.name)).toEqual(["id", "total"]);
  });

  test("relations: create with N:N, edit and delete", () => {
    const added = addRelation(ER, "Venta", "Venta");
    expect(added.spec.relations[0]).toMatchObject({ fromCard: "0..N", toCard: "0..N" });
    const updated = updateRelation(added.spec, 0, { label: "groups", fromCard: "1", toCard: "N" });
    expect(updated.relations[0]).toMatchObject({ label: "groups", fromCard: "1", toCard: "N" });
    const unlabeled = updateRelation(updated, 0, { label: null });
    expect(unlabeled.relations[0].label).toBeUndefined();
    expect(removeRelation(unlabeled, 0).relations).toHaveLength(0);
  });

  test("design metadata", () => {
    expect(updateMeta(META, { title: "New" })).toMatchObject({ title: "New", explanation: "Explanation." });
  });
});

describe("orientative validation", () => {
  test("a valid draft reports nothing", () => {
    expect(validateDraft("flow", FLOW, META, ["req-1"])).toEqual({ errors: [], warnings: [] });
    expect(validateDraft("data_model", ER, META, ["req-1"])).toEqual({ errors: [], warnings: [] });
  });

  test("structural errors with element involved", () => {
    const dup: FlowSpec = { nodes: [...FLOW.nodes, { ...FLOW.nodes[0] }], edges: [] };
    const result = validateDraft("flow", dup, META, ["req-1"]);
    expect(result.errors.some((e) => e.code === "node-id" && e.element === "start")).toBe(true);
  });

  test("out-of-set citations are flagged", () => {
    const result = validateDraft("flow", FLOW, META, ["req-9"]);
    expect(result.errors.some((e) => e.code === "refs")).toBe(true);
  });

  test("mandatory metadata", () => {
    const result = validateDraft("flow", FLOW, { title: "", explanation: "", questions: [] }, ["req-1"]);
    expect(result.errors.map((e) => e.code)).toContain("title");
    expect(result.errors.map((e) => e.code)).toContain("explanation");
  });

  test("warnings without forbidding: valid cycles, starts and decisions", () => {
    const cyclic: FlowSpec = {
      nodes: [
        { id: "a", kind: "step", label: "A", requirements: [], mockups: [] },
        { id: "b", kind: "decision", label: "B", requirements: [], mockups: [] },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const result = validateDraft("flow", cyclic, META, []);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("no-start");
    expect(result.warnings.map((w) => w.code)).toContain("decision");
    expect(result.warnings.some((w) => w.code === "unreachable")).toBe(false);
  });

  test("ER warnings: no key and isolated", () => {
    const spec: ErSpec = {
      entities: [
        { name: "A", attributes: [{ name: "x", key: false }], requirements: [], mockups: [] },
        { name: "B", attributes: [{ name: "id", key: true }], requirements: [], mockups: [] },
      ],
      relations: [],
    };
    const result = validateDraft("data_model", spec, META, []);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("no-key");
    expect(result.warnings.map((w) => w.code)).toContain("isolated");
  });

  test("subset limits", () => {
    const many: FlowSpec = {
      nodes: Array.from({ length: 25 }, (_, i) => ({
        id: `n${i}`,
        kind: "step" as const,
        label: `N${i}`,
        requirements: [],
        mockups: [],
      })),
      edges: [],
    };
    const result = validateDraft("flow", many, META, []);
    expect(result.errors.some((e) => e.code === "nodes")).toBe(true);
  });
});

describe("lifted draft", () => {
  const BASE = '{"title":"Base"}';
  function init(): VisualDraftState {
    const state = visualDraftReducer(null, {
      type: "init",
      key: "flujo-1:flujo-1-v1",
      kind: "flow",
      base: BASE,
      layout: { a: { x: 1, y: 1 } },
      allowed: ["req-1"],
      pins: ["req-1-v1"],
    });
    if (state === null) throw new Error("inits");
    return state;
  }

  test("starts clean and keeps the key", () => {
    const state = init();
    expect(visualSemanticDirty(state)).toBe(false);
    expect(visualLayoutDirty(state)).toBe(false);
    expect(visualDraftReducer(state, { type: "reset" })).toBeNull();
  });

  test("moving dirties only layout; editing, semantics", () => {
    let state: VisualDraftState | null = init();
    state = visualDraftReducer(state, { type: "move", id: "a", x: 5, y: 5 });
    expect(visualSemanticDirty(state)).toBe(false);
    expect(visualLayoutDirty(state)).toBe(true);
    state = visualDraftReducer(state, { type: "apply", spec: '{"title":"Change"}' });
    expect(visualSemanticDirty(state)).toBe(true);
    state = visualDraftReducer(state, { type: "undo" });
    expect(visualSemanticDirty(state)).toBe(false);
    expect(visualLayoutDirty(state)).toBe(true);
  });

  test("saving layout clears only the visual part; the guard asks to confirm", () => {
    let state: VisualDraftState | null = init();
    state = visualDraftReducer(state, { type: "move", id: "a", x: 5, y: 5 });
    if (state === null) throw new Error("moves");
    state = visualDraftReducer(state, { type: "savedLayout", layout: state.layout });
    expect(visualLayoutDirty(state)).toBe(false);
    state = visualDraftReducer(state, { type: "apply", spec: '{"title":"Change"}' });
    expect(needsVisualConfirm(state, "flujo-1", "flujo-2")).toBe(true);
    expect(needsVisualConfirm(state, "flujo-1", "flujo-1")).toBe(false);
    expect(needsVisualConfirm(null, "flujo-1", "flujo-2")).toBe(false);
  });

  test("a late result does not clear edits made during the save", () => {
    const fresh = init();
    // No changes during the request: clears (null, the detail moved on).
    expect(
      visualDraftReducer(fresh, {
        type: "saved",
        present: fresh.history.present,
        pins: fresh.pins,
        allowed: fresh.allowed,
      }),
    ).toBeNull();
    // With an intermediate edit: kept for conflict resolution.
    let moved: VisualDraftState | null = init();
    moved = visualDraftReducer(moved, { type: "apply", spec: '{"title":"New"}' });
    const kept = visualDraftReducer(moved, {
      type: "saved",
      present: BASE,
      pins: ["req-1-v1"],
      allowed: ["req-1"],
    });
    expect(kept).not.toBeNull();
    expect(visualSemanticDirty(kept)).toBe(true);
    // Moves made during the layout save stay pending.
    let layout: VisualDraftState | null = init();
    layout = visualDraftReducer(layout, { type: "move", id: "a", x: 5, y: 5 });
    const staleLayout = visualDraftReducer(layout, {
      type: "savedLayout",
      layout: { a: { x: 1, y: 1 } },
    });
    expect(visualLayoutDirty(staleLayout)).toBe(true);
  });
});

describe("history", () => {
  test("undo and redo walk semantic changes", () => {
    let history = createHistory("v1");
    expect(canUndo(history)).toBe(false);
    history = pushHistory(history, "v2");
    history = pushHistory(history, "v3");
    history = pushHistory(history, "v3");
    expect(canUndo(history)).toBe(true);
    history = undoHistory(history);
    expect(history.present).toBe("v2");
    expect(canRedo(history)).toBe(true);
    history = redoHistory(history);
    expect(history.present).toBe("v3");
    history = undoHistory(undoHistory(history));
    expect(history.present).toBe("v1");
    expect(canUndo(history)).toBe(false);
  });

  test("a new change discards redo and respects the cap", () => {
    let history = createHistory("v0");
    for (let i = 1; i <= 60; i++) history = pushHistory(history, `v${i}`);
    expect(history.past.length).toBeLessThanOrEqual(50);
    history = undoHistory(history);
    history = pushHistory(history, "branch");
    expect(canRedo(history)).toBe(false);
    expect(history.present).toBe("branch");
  });
});
