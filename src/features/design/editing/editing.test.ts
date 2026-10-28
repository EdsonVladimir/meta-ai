// Editor visual: adaptadores, operaciones, validación e historial.
// Puros y deterministas; el lienzo (React Flow) se verifica aparte.
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

const META: DesignMeta = { title: "Diseño", explanation: "Explicación.", questions: [] };

const FLOW: FlowSpec = {
  nodes: [
    { id: "inicio", kind: "start", label: "Inicio", requirements: ["req-1"] },
    { id: "fin", kind: "end", label: "Fin", requirements: [] },
  ],
  edges: [{ from: "inicio", to: "fin" }],
};

const ER: ErSpec = {
  entities: [
    {
      name: "Venta",
      attributes: [
        { name: "id", key: true },
        { name: "total", key: false },
      ],
      requirements: ["req-1"],
    },
  ],
  relations: [],
};

describe("parseo y serialización", () => {
  test("flujo: ida y vuelta sin pérdida semántica", () => {
    const canonical = serializeFlowSpec(FLOW, META);
    expect(canonical).toContain('"kind":"flow"');
    const parsed = parseFlowSpec(JSON.parse(canonical));
    expect(parsed).not.toBeNull();
    expect(parsed?.spec).toEqual(FLOW);
    expect(parsed?.meta).toEqual(META);
    expect(serializeFlowSpec(parsed!.spec, parsed!.meta)).toBe(canonical);
  });

  test("ER: ida y vuelta sin pérdida semántica", () => {
    const canonical = serializeErSpec(ER, META);
    expect(canonical).toContain('"kind":"data_model"');
    const parsed = parseErSpec(JSON.parse(canonical));
    expect(parsed?.spec).toEqual(ER);
    expect(serializeErSpec(parsed!.spec, parsed!.meta)).toBe(canonical);
    // Las cardinalidades viajan en snake_case.
    const withRelation: ErSpec = {
      ...ER,
      relations: [{ from: "Venta", to: "Venta", fromCard: "1", toCard: "N" }],
    };
    const rel = serializeErSpec(withRelation, META);
    expect(rel).toContain('"from_card":"1"');
    expect(rel).toContain('"to_card":"N"');
    expect(parseErSpec(JSON.parse(rel))?.spec).toEqual(withRelation);
  });

  test("formas ajenas se rechazan", () => {
    expect(parseFlowSpec(null)).toBeNull();
    expect(parseFlowSpec({})).toBeNull();
    expect(parseFlowSpec({ title: "x", explanation: "y", questions: [], nodes: {}, edges: [] })).toBeNull();
    expect(parseFlowSpec({ title: "x", explanation: "y", questions: [], nodes: [{ id: 1 }], edges: [] })).toBeNull();
    expect(parseErSpec({ title: "x", explanation: "y", questions: [], entities: [], relations: [] })).not.toBeNull();
    expect(parseErSpec({ title: "x", explanation: "y", questions: "no", entities: [], relations: [] })).toBeNull();
  });

  test("disposición tolerante: solo posiciones válidas", () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout({ a: { x: 1, y: 2 }, b: { x: "mal" }, "": { x: 0, y: 0 } })).toEqual({
      a: { x: 1, y: 2 },
    });
  });
});

describe("adaptadores al lienzo", () => {
  test("la disposición guardada manda; el resto usa trazado automático", () => {
    const { nodes, edges } = flowToGraph(FLOW, { fin: { x: 500, y: 500 } });
    expect(nodes.find((n) => n.id === "fin")).toMatchObject({ x: 500, y: 500 });
    expect(nodes.find((n) => n.id === "inicio")).toMatchObject({ x: 60, y: 60 });
    expect(edges).toEqual([{ id: "e0", from: "inicio", to: "fin" }]);
    // Las capas siguen el sentido de las conexiones.
    expect(nodes.find((n) => n.id === "fin")!.x).toBeGreaterThan(
      nodes.find((n) => n.id === "inicio")!.x - 500,
    );
  });

  test("el trazado automático es determinista y seguro ante ciclos", () => {
    const cyclic: FlowSpec = {
      nodes: [
        { id: "a", kind: "step", label: "A", requirements: [] },
        { id: "b", kind: "step", label: "B", requirements: [] },
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

  test("ER usa rejilla estable en el orden de la especificación", () => {
    const spec: ErSpec = {
      entities: [
        { name: "B", attributes: [{ name: "id", key: true }], requirements: [] },
        { name: "A", attributes: [{ name: "id", key: true }], requirements: [] },
      ],
      relations: [],
    };
    const { nodes } = erToGraph(spec, {});
    expect(nodes[0].id).toBe("B");
    expect(nodes[0]).toMatchObject({ x: 60, y: 60 });
    expect(erToGraph(spec, {})).toEqual(erToGraph(spec, {}));
  });

  test("renombrar reubica la posición guardada", () => {
    expect(remapLayout({ a: { x: 1, y: 1 } }, "a", "b")).toEqual({ b: { x: 1, y: 1 } });
    expect(remapLayout({ a: { x: 1, y: 1 } }, "a", "a")).toEqual({ a: { x: 1, y: 1 } });
  });

  test("detecta renombrados únicos e ignora altas y bajas", () => {
    const renamed = renameFlowNodeId(FLOW, "inicio", "arranque").spec;
    expect(detectRename("flow", FLOW, renamed)).toEqual(["inicio", "arranque"]);
    expect(detectRename("flow", FLOW, addFlowNode(FLOW, "step").spec)).toBeNull();
    expect(detectRename("flow", FLOW, FLOW)).toBeNull();
    const renamedEr = renameEntity(ER, "Venta", "Ticket").spec;
    expect(detectRename("data_model", ER, renamedEr)).toEqual(["Venta", "Ticket"]);
  });

  test("deriva artefactos de versiones con forma conocida", () => {
    expect(artifactOfVersion("req-1-v2")).toBe("req-1");
    expect(artifactOfVersion("flujo-1-v10")).toBe("flujo-1");
    expect(artifactOfVersion("rara")).toBeNull();
    expect(artifactOfVersion("")).toBeNull();
  });

  test("las ramas de una decisión salen por derecha, izquierda y abajo", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "d", kind: "decision", label: "¿Stock?", requirements: [] },
        { id: "a", kind: "step", label: "A", requirements: [] },
        { id: "b", kind: "step", label: "B", requirements: [] },
        { id: "c", kind: "step", label: "C", requirements: [] },
      ],
      edges: [
        { from: "d", to: "a", label: "Sí" },
        { from: "d", to: "b", label: "No" },
        { from: "d", to: "c" },
        { from: "a", to: "b" },
      ],
    };
    expect(decisionBranchHandles(spec)).toEqual(["right", "left", "bottom", null]);
  });

  test("una decisión con una sola rama sale por abajo", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "d", kind: "decision", label: "¿Sigo?", requirements: [] },
        { id: "a", kind: "step", label: "A", requirements: [] },
      ],
      edges: [{ from: "d", to: "a" }],
    };
    expect(decisionBranchHandles(spec)).toEqual(["bottom"]);
  });

  test("cada decisión reparte sus propias ramas sin interferir", () => {
    const spec: FlowSpec = {
      nodes: [
        { id: "d1", kind: "decision", label: "Una", requirements: [] },
        { id: "d2", kind: "decision", label: "Dos", requirements: [] },
        { id: "a", kind: "step", label: "A", requirements: [] },
        { id: "b", kind: "step", label: "B", requirements: [] },
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

describe("operaciones de flujo", () => {
  test("añadir nodos genera identidades libres", () => {
    const first = addFlowNode(FLOW, "step");
    expect(first.id).toBe("paso");
    const second = addFlowNode(first.spec, "step");
    expect(second.id).toBe("paso_2");
    expect(second.spec.nodes).toHaveLength(4);
    expect(FLOW.nodes).toHaveLength(2);
  });

  test("editar etiqueta, tipo y citas", () => {
    const next = updateFlowNode(FLOW, "fin", { label: "Cierre", kind: "step", requirements: ["req-2"] });
    expect(next.nodes[1]).toMatchObject({ label: "Cierre", kind: "step", requirements: ["req-2"] });
  });

  test("renombrar identidad reescribe aristas", () => {
    const renamed = renameFlowNodeId(FLOW, "inicio", "arranque");
    expect(renamed.ok).toBe(true);
    expect(renamed.spec.edges).toEqual([{ from: "arranque", to: "fin" }]);
  });

  test("renombrar rechaza duplicados e inválidos sin mutar", () => {
    expect(renameFlowNodeId(FLOW, "inicio", "fin")).toMatchObject({ ok: false });
    expect(renameFlowNodeId(FLOW, "inicio", "con espacios")).toMatchObject({ ok: false });
    expect(renameFlowNodeId(FLOW, "inicio", "")).toMatchObject({ ok: false });
    const rejected = renameFlowNodeId(FLOW, "inicio", "fin");
    expect(rejected.spec).toBe(FLOW);
  });

  test("eliminar nodo informa conexiones caídas", () => {
    const removed = removeFlowNode(FLOW, "inicio");
    expect(removed.spec.nodes.map((n) => n.id)).toEqual(["fin"]);
    expect(removed.removedEdges).toBe(1);
    expect(flowDeleteConsequences(FLOW, "inicio")).toEqual([
      "Elimina el nodo «inicio».",
      "Elimina 1 conexión que lo toca.",
      "Sus citas a requisitos desaparecen con él (los requisitos no cambian).",
    ]);
  });

  test("conexiones: crear, etiquetar y eliminar", () => {
    const added = addFlowEdge(FLOW, "fin", "inicio");
    expect(added.index).toBe(1);
    const labeled = updateFlowEdge(added.spec, 1, "reintento");
    expect(labeled.edges[1]).toMatchObject({ label: "reintento" });
    const cleared = updateFlowEdge(labeled, 1, null);
    expect(cleared.edges[1]).toEqual({ from: "fin", to: "inicio" });
    expect(removeFlowEdge(cleared, 0).edges).toHaveLength(1);
  });

  test("suggestId salta ocupados", () => {
    expect(suggestId("paso", new Set(["paso", "paso_2"]))).toBe("paso_3");
    expect(suggestId("", new Set())).toBe("elemento");
  });
});

describe("operaciones ER", () => {
  test("añadir entidad trae atributo inicial", () => {
    const added = addEntity(ER);
    expect(added.name).toBe("Entidad");
    const entity = added.spec.entities.find((e) => e.name === "Entidad");
    expect(entity?.attributes).toHaveLength(1);
  });

  test("renombrar entidad reescribe relaciones", () => {
    const spec: ErSpec = {
      ...ER,
      entities: [...ER.entities, { name: "Linea", attributes: [{ name: "id", key: true }], requirements: [] }],
      relations: [{ from: "Venta", to: "Linea", fromCard: "1", toCard: "0..N" }],
    };
    const renamed = renameEntity(spec, "Venta", "Ticket");
    expect(renamed.ok).toBe(true);
    expect(renamed.spec.relations[0]).toMatchObject({ from: "Ticket" });
    expect(renameEntity(spec, "Venta", "Linea").ok).toBe(false);
  });

  test("eliminar entidad informa atributos y relaciones", () => {
    const spec: ErSpec = {
      ...ER,
      entities: [...ER.entities, { name: "Linea", attributes: [{ name: "id", key: true }], requirements: [] }],
      relations: [{ from: "Venta", to: "Linea", fromCard: "1", toCard: "0..N" }],
    };
    const removed = removeEntity(spec, "Venta");
    expect(removed.removedAttributes).toBe(2);
    expect(removed.removedRelations).toBe(1);
    expect(erDeleteConsequences(spec, "Venta")).toContain("Elimina 2 atributos.");
  });

  test("atributos: añadir, renombrar, clave y eliminar", () => {
    const added = addAttribute(ER, "Venta");
    expect(added.name).toBe("atributo");
    const renamed = renameAttribute(added.spec, "Venta", "atributo", "codigo");
    expect(renamed.ok).toBe(true);
    expect(renameAttribute(renamed.spec, "Venta", "codigo", "id").ok).toBe(false);
    const keyed = setAttributeKey(renamed.spec, "Venta", "codigo", true);
    expect(keyed.entities[0].attributes.find((a) => a.name === "codigo")?.key).toBe(true);
    const removed = removeAttribute(keyed, "Venta", "codigo");
    expect(removed.entities[0].attributes.map((a) => a.name)).toEqual(["id", "total"]);
  });

  test("relaciones: crear con N:N, editar y eliminar", () => {
    const added = addRelation(ER, "Venta", "Venta");
    expect(added.spec.relations[0]).toMatchObject({ fromCard: "0..N", toCard: "0..N" });
    const updated = updateRelation(added.spec, 0, { label: "agrupa", fromCard: "1", toCard: "N" });
    expect(updated.relations[0]).toMatchObject({ label: "agrupa", fromCard: "1", toCard: "N" });
    const unlabeled = updateRelation(updated, 0, { label: null });
    expect(unlabeled.relations[0].label).toBeUndefined();
    expect(removeRelation(unlabeled, 0).relations).toHaveLength(0);
  });

  test("metadatos del diseño", () => {
    expect(updateMeta(META, { title: "Nuevo" })).toMatchObject({ title: "Nuevo", explanation: "Explicación." });
  });
});

describe("validación orientativa", () => {
  test("borrador válido no informa nada", () => {
    expect(validateDraft("flow", FLOW, META, ["req-1"])).toEqual({ errors: [], warnings: [] });
    expect(validateDraft("data_model", ER, META, ["req-1"])).toEqual({ errors: [], warnings: [] });
  });

  test("errores estructurales con elemento implicado", () => {
    const dup: FlowSpec = { nodes: [...FLOW.nodes, { ...FLOW.nodes[0] }], edges: [] };
    const result = validateDraft("flow", dup, META, ["req-1"]);
    expect(result.errors.some((e) => e.code === "node-id" && e.element === "inicio")).toBe(true);
  });

  test("citas fuera del conjunto se señalan", () => {
    const result = validateDraft("flow", FLOW, META, ["req-9"]);
    expect(result.errors.some((e) => e.code === "refs")).toBe(true);
  });

  test("metadatos obligatorios", () => {
    const result = validateDraft("flow", FLOW, { title: "", explanation: "", questions: [] }, ["req-1"]);
    expect(result.errors.map((e) => e.code)).toContain("title");
    expect(result.errors.map((e) => e.code)).toContain("explanation");
  });

  test("avisos sin prohibir: ciclos válidos, inicios y decisiones", () => {
    const cyclic: FlowSpec = {
      nodes: [
        { id: "a", kind: "step", label: "A", requirements: [] },
        { id: "b", kind: "decision", label: "B", requirements: [] },
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

  test("avisos ER: sin clave y aisladas", () => {
    const spec: ErSpec = {
      entities: [
        { name: "A", attributes: [{ name: "x", key: false }], requirements: [] },
        { name: "B", attributes: [{ name: "id", key: true }], requirements: [] },
      ],
      relations: [],
    };
    const result = validateDraft("data_model", spec, META, []);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("no-key");
    expect(result.warnings.map((w) => w.code)).toContain("isolated");
  });

  test("topes del subconjunto", () => {
    const many: FlowSpec = {
      nodes: Array.from({ length: 25 }, (_, i) => ({
        id: `n${i}`,
        kind: "step" as const,
        label: `N${i}`,
        requirements: [],
      })),
      edges: [],
    };
    const result = validateDraft("flow", many, META, []);
    expect(result.errors.some((e) => e.code === "nodes")).toBe(true);
  });
});

describe("borrador elevado", () => {
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
    if (state === null) throw new Error("inicia");
    return state;
  }

  test("inicia limpio y conserva la clave", () => {
    const state = init();
    expect(visualSemanticDirty(state)).toBe(false);
    expect(visualLayoutDirty(state)).toBe(false);
    expect(visualDraftReducer(state, { type: "reset" })).toBeNull();
  });

  test("mover solo ensucia la disposición; editar, la semántica", () => {
    let state: VisualDraftState | null = init();
    state = visualDraftReducer(state, { type: "move", id: "a", x: 5, y: 5 });
    expect(visualSemanticDirty(state)).toBe(false);
    expect(visualLayoutDirty(state)).toBe(true);
    state = visualDraftReducer(state, { type: "apply", spec: '{"title":"Cambio"}' });
    expect(visualSemanticDirty(state)).toBe(true);
    state = visualDraftReducer(state, { type: "undo" });
    expect(visualSemanticDirty(state)).toBe(false);
    expect(visualLayoutDirty(state)).toBe(true);
  });

  test("guardar disposición limpia solo lo visual; el guard pide confirmar", () => {
    let state: VisualDraftState | null = init();
    state = visualDraftReducer(state, { type: "move", id: "a", x: 5, y: 5 });
    if (state === null) throw new Error("mueve");
    state = visualDraftReducer(state, { type: "savedLayout", layout: state.layout });
    expect(visualLayoutDirty(state)).toBe(false);
    state = visualDraftReducer(state, { type: "apply", spec: '{"title":"Cambio"}' });
    expect(needsVisualConfirm(state, "flujo-1", "flujo-2")).toBe(true);
    expect(needsVisualConfirm(state, "flujo-1", "flujo-1")).toBe(false);
    expect(needsVisualConfirm(null, "flujo-1", "flujo-2")).toBe(false);
  });

  test("el resultado tardío no limpia lo editado durante el guardado", () => {
    const fresh = init();
    // Sin cambios durante la petición: limpia (null, el detalle avanzó).
    expect(
      visualDraftReducer(fresh, {
        type: "saved",
        present: fresh.history.present,
        pins: fresh.pins,
        allowed: fresh.allowed,
      }),
    ).toBeNull();
    // Con edición intermedia: se conserva para resolver el conflicto.
    let moved: VisualDraftState | null = init();
    moved = visualDraftReducer(moved, { type: "apply", spec: '{"title":"Nuevo"}' });
    const kept = visualDraftReducer(moved, {
      type: "saved",
      present: BASE,
      pins: ["req-1-v1"],
      allowed: ["req-1"],
    });
    expect(kept).not.toBeNull();
    expect(visualSemanticDirty(kept)).toBe(true);
    // Lo movido durante el guardado de disposición sigue pendiente.
    let layout: VisualDraftState | null = init();
    layout = visualDraftReducer(layout, { type: "move", id: "a", x: 5, y: 5 });
    const staleLayout = visualDraftReducer(layout, {
      type: "savedLayout",
      layout: { a: { x: 1, y: 1 } },
    });
    expect(visualLayoutDirty(staleLayout)).toBe(true);
  });
});

describe("historial", () => {
  test("deshacer y rehacer recorren cambios semánticos", () => {
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

  test("un cambio nuevo descarta el rehacer y respeta el tope", () => {
    let history = createHistory("v0");
    for (let i = 1; i <= 60; i++) history = pushHistory(history, `v${i}`);
    expect(history.past.length).toBeLessThanOrEqual(50);
    history = undoHistory(history);
    history = pushHistory(history, "rama");
    expect(canRedo(history)).toBe(false);
    expect(history.present).toBe("rama");
  });
});
