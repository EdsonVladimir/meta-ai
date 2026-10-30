// Semantic model of the visual design editor. Pure: no React, no Tauri.
// The structured JSON stays authoritative; this module parses it,
// transforms it with total operations and serializes it canonically.
// Visual positions do NOT live here (see Layout): moving an element
// never touches semantics. Mirrors the
// `src-tauri/crates/meta/src/design.rs` subset:
// - Flow: start|step|decision|end nodes with id/label/citations, edges
//   with origin/target/optional label. Cycles are valid.
// - ER: entities with name/attributes (name + key mark, NO types:
//   outside the subset) and citations; relations with ends, optional
//   label and 1|0..1|N|0..N cardinalities.
// Requirement references are stable ARTIFACT identifiers.

export type FlowNodeKind = "start" | "step" | "decision" | "end";
export type Cardinality = "1" | "0..1" | "N" | "0..N";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  requirements: string[];
  /** Citations to `mockup/component` motivating the node (informational). */
  mockups: string[];
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowSpec {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface ErAttribute {
  name: string;
  key: boolean;
}

export interface ErEntity {
  name: string;
  attributes: ErAttribute[];
  requirements: string[];
  /** Citations to `mockup/component` motivating the entity (informational). */
  mockups: string[];
}

export interface ErRelation {
  from: string;
  to: string;
  label?: string;
  fromCard: Cardinality;
  toCard: Cardinality;
}

export interface ErSpec {
  entities: ErEntity[];
  relations: ErRelation[];
}

export interface DesignMeta {
  title: string;
  explanation: string;
  questions: string[];
}

/**
 * Visual layout: positions (and optional size) per element identifier.
 * `w`/`h` are only used by resizable mockups; diagrams save position
 * and ignore them.
 */
export type Layout = Record<string, { x: number; y: number; w?: number; h?: number }>;

/** Canvas-ready node: semantics + resolved position. */
export interface CanvasNode<T> {
  id: string;
  x: number;
  y: number;
  data: T;
}

export interface CanvasEdge {
  /** Positional identity (`e0`, `e1`…): edges have no id of their own. */
  id: string;
  from: string;
  to: string;
  label?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item): item is string => typeof item === "string")) return null;
  return [...value];
}

const FLOW_KINDS: FlowNodeKind[] = ["start", "step", "decision", "end"];

/** Parses a saved flow (canonical content). Null on foreign shape. */
export function parseFlowSpec(value: unknown): { spec: FlowSpec; meta: DesignMeta } | null {
  if (!isRecord(value)) return null;
  const meta = parseMeta(value);
  if (meta === null) return null;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const nodes: FlowNode[] = [];
  for (const raw of value.nodes) {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string") return null;
    if (typeof raw.kind !== "string" || !FLOW_KINDS.includes(raw.kind as FlowNodeKind)) return null;
    if (typeof raw.label !== "string") return null;
    const requirements = stringList(raw.requirements);
    if (requirements === null) return null;
    // Optional and missing in older designs: tolerate.
    const mockups = raw.mockups === undefined || raw.mockups === null ? [] : stringList(raw.mockups);
    if (mockups === null) return null;
    nodes.push({ id: raw.id, kind: raw.kind as FlowNodeKind, label: raw.label, requirements, mockups });
  }
  const edges: FlowEdge[] = [];
  for (const raw of value.edges) {
    if (!isRecord(raw)) return null;
    if (typeof raw.from !== "string" || typeof raw.to !== "string") return null;
    if (raw.label !== undefined && raw.label !== null && typeof raw.label !== "string") return null;
    edges.push(
      raw.label === undefined || raw.label === null
        ? { from: raw.from, to: raw.to }
        : { from: raw.from, to: raw.to, label: raw.label },
    );
  }
  return { spec: { nodes, edges }, meta };
}

const CARDS: Cardinality[] = ["1", "0..1", "N", "0..N"];

/** Parses a saved ER model (canonical content). Null on foreign shape. */
export function parseErSpec(value: unknown): { spec: ErSpec; meta: DesignMeta } | null {
  if (!isRecord(value)) return null;
  const meta = parseMeta(value);
  if (meta === null) return null;
  if (!Array.isArray(value.entities) || !Array.isArray(value.relations)) return null;
  const entities: ErEntity[] = [];
  for (const raw of value.entities) {
    if (!isRecord(raw)) return null;
    if (typeof raw.name !== "string") return null;
    if (!Array.isArray(raw.attributes)) return null;
    const requirements = stringList(raw.requirements);
    if (requirements === null) return null;
    const mockups = raw.mockups === undefined || raw.mockups === null ? [] : stringList(raw.mockups);
    if (mockups === null) return null;
    const attributes: ErAttribute[] = [];
    for (const attr of raw.attributes) {
      if (!isRecord(attr)) return null;
      if (typeof attr.name !== "string") return null;
      if (attr.key !== undefined && typeof attr.key !== "boolean") return null;
      attributes.push({ name: attr.name, key: attr.key === true });
    }
    entities.push({ name: raw.name, attributes, requirements, mockups });
  }
  const relations: ErRelation[] = [];
  for (const raw of value.relations) {
    if (!isRecord(raw)) return null;
    if (typeof raw.from !== "string" || typeof raw.to !== "string") return null;
    if (raw.label !== undefined && raw.label !== null && typeof raw.label !== "string") return null;
    if (typeof raw.from_card !== "string" || !CARDS.includes(raw.from_card as Cardinality)) {
      return null;
    }
    if (typeof raw.to_card !== "string" || !CARDS.includes(raw.to_card as Cardinality)) {
      return null;
    }
    relations.push({
      from: raw.from,
      to: raw.to,
      ...(raw.label === undefined || raw.label === null ? {} : { label: raw.label }),
      fromCard: raw.from_card as Cardinality,
      toCard: raw.to_card as Cardinality,
    });
  }
  return { spec: { entities, relations }, meta };
}

function parseMeta(value: Record<string, unknown>): DesignMeta | null {
  if (typeof value.title !== "string") return null;
  if (typeof value.explanation !== "string") return null;
  const questions = stringList(value.questions);
  if (questions === null) return null;
  return { title: value.title, explanation: value.explanation, questions };
}

/** Canonical serialization: same key order as Rust (`title`, `kind`, …). */
export function serializeFlowSpec(spec: FlowSpec, meta: DesignMeta): string {
  return JSON.stringify({
    title: meta.title,
    kind: "flow",
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      requirements: n.requirements,
      ...(n.mockups.length > 0 ? { mockups: n.mockups } : {}),
    })),
    edges: spec.edges.map((e) => (e.label === undefined ? { from: e.from, to: e.to } : e)),
    explanation: meta.explanation,
    questions: meta.questions,
  });
}

/** Canonical serialization of the ER model. */
export function serializeErSpec(spec: ErSpec, meta: DesignMeta): string {
  return JSON.stringify({
    title: meta.title,
    kind: "data_model",
    entities: spec.entities.map((e) => ({
      name: e.name,
      attributes: e.attributes.map((a) => ({ name: a.name, key: a.key })),
      requirements: e.requirements,
      ...(e.mockups.length > 0 ? { mockups: e.mockups } : {}),
    })),
    relations: spec.relations.map((r) => ({
      from: r.from,
      to: r.to,
      ...(r.label === undefined ? {} : { label: r.label }),
      from_card: r.fromCard,
      to_card: r.toCard,
    })),
    explanation: meta.explanation,
    questions: meta.questions,
  });
}

/** Interprets a saved layout tolerantly: only valid entries. */
export function parseLayout(value: unknown): Layout {
  const layout: Layout = {};
  if (!isRecord(value)) return layout;
  for (const [key, position] of Object.entries(value)) {
    if (key.trim() === "") continue;
    if (!isRecord(position)) continue;
    const { x, y, w, h } = position;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const entry: { x: number; y: number; w?: number; h?: number } = { x, y };
    if (typeof w === "number" && Number.isFinite(w) && w > 0) entry.w = w;
    if (typeof h === "number" && Number.isFinite(h) && h > 0) entry.h = h;
    layout[key] = entry;
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Deterministic auto layout (only without a saved layout).
// ---------------------------------------------------------------------------

const FLOW_DX = 240;
const FLOW_DY = 130;
const ER_DX = 300;
const ER_DY = 230;

/**
 * Breadth layers from the roots (no incoming edges), stable in spec
 * order. Cycle-safe: unreachable nodes fall to the end.
 */
function flowLayers(spec: FlowSpec): Map<string, number> {
  const layers = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const node of spec.nodes) incoming.set(node.id, 0);
  for (const edge of spec.edges) {
    if (incoming.has(edge.from) && incoming.has(edge.to)) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const node of spec.nodes) {
    if ((incoming.get(node.id) ?? 0) === 0) {
      layers.set(node.id, 0);
      queue.push(node.id);
    }
  }
  if (queue.length === 0 && spec.nodes.length > 0) {
    // All in cycles: start from the first without breaking determinism.
    layers.set(spec.nodes[0].id, 0);
    queue.push(spec.nodes[0].id);
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of spec.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const visiting = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const layer = layers.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      if (visiting.has(next)) continue;
      visiting.add(next);
      layers.set(next, layer + 1);
      queue.push(next);
    }
  }
  let max = 0;
  for (const layer of layers.values()) max = Math.max(max, layer);
  for (const node of spec.nodes) {
    if (!layers.has(node.id)) layers.set(node.id, max + 1);
  }
  return layers;
}

/** Flow → canvas: the layout wins; the rest uses auto layout. */
export function flowToGraph(
  spec: FlowSpec,
  layout: Layout,
): { nodes: CanvasNode<FlowNode>[]; edges: CanvasEdge[] } {
  const layers = flowLayers(spec);
  const counters = new Map<number, number>();
  const nodes = spec.nodes.map((node) => {
    const saved = layout[node.id];
    if (saved !== undefined) return { id: node.id, x: saved.x, y: saved.y, data: node };
    const layer = layers.get(node.id) ?? 0;
    const row = counters.get(layer) ?? 0;
    counters.set(layer, row + 1);
    return { id: node.id, x: 60 + layer * FLOW_DX, y: 60 + row * FLOW_DY, data: node };
  });
  const edges = spec.edges.map((edge, index) => ({
    id: `e${index}`,
    from: edge.from,
    to: edge.to,
    ...(edge.label === undefined ? {} : { label: edge.label }),
  }));
  return { nodes, edges };
}

/**
 * Exit vertex for each edge from a decision (presentation only: ids
 * match the diamond handles). Deterministic rule in spec order: a
 * single branch exits at the bottom; with two or more, the first goes
 * right, the second left and the rest bottom. `null` = default handle.
 */
export function decisionBranchHandles(spec: FlowSpec): (string | null)[] {
  const kinds = new Map(spec.nodes.map((node) => [node.id, node.kind]));
  const totals = new Map<string, number>();
  for (const edge of spec.edges) {
    if (kinds.get(edge.from) === "decision") {
      totals.set(edge.from, (totals.get(edge.from) ?? 0) + 1);
    }
  }
  const seen = new Map<string, number>();
  return spec.edges.map((edge) => {
    const total = totals.get(edge.from);
    if (total === undefined) return null;
    const index = seen.get(edge.from) ?? 0;
    seen.set(edge.from, index + 1);
    if (total === 1) return "bottom";
    if (index === 0) return "right";
    if (index === 1) return "left";
    return "bottom";
  });
}

/** ER → canvas: stable grid in spec order. */
export function erToGraph(
  spec: ErSpec,
  layout: Layout,
): { nodes: CanvasNode<ErEntity>[]; edges: CanvasEdge[] } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(spec.entities.length)));
  const nodes = spec.entities.map((entity, index) => {
    const saved = layout[entity.name];
    if (saved !== undefined) return { id: entity.name, x: saved.x, y: saved.y, data: entity };
    const col = index % cols;
    const row = Math.floor(index / cols);
    return { id: entity.name, x: 60 + col * ER_DX, y: 60 + row * ER_DY, data: entity };
  });
  const edges = spec.relations.map((relation, index) => ({
    id: `e${index}`,
    from: relation.from,
    to: relation.to,
    ...(relation.label === undefined ? {} : { label: relation.label }),
  }));
  return { nodes, edges };
}

/** On element rename, its saved position follows. */
export function remapLayout(layout: Layout, oldId: string, newId: string): Layout {
  if (oldId === newId || layout[oldId] === undefined) return layout;
  const next = { ...layout };
  next[newId] = next[oldId];
  delete next[oldId];
  return next;
}

/**
 * Detects a single rename between two specs ([old, new]). The editor
 * uses it to carry the saved position. Null on additions/removals or
 * several changes (partial layout is kept anyway: unknown falls back
 * to auto layout).
 */
export function detectRename(
  kind: "flow" | "data_model",
  oldSpec: FlowSpec | ErSpec,
  newSpec: FlowSpec | ErSpec,
): [string, string] | null {
  const oldIds =
    kind === "flow"
      ? (oldSpec as FlowSpec).nodes.map((n) => n.id)
      : (oldSpec as ErSpec).entities.map((e) => e.name);
  const newIds =
    kind === "flow"
      ? (newSpec as FlowSpec).nodes.map((n) => n.id)
      : (newSpec as ErSpec).entities.map((e) => e.name);
  if (oldIds.length !== newIds.length) return null;
  const gone = oldIds.filter((id) => !newIds.includes(id));
  const came = newIds.filter((id) => !oldIds.includes(id));
  if (gone.length !== 1 || came.length !== 1) return null;
  return [gone[0], came[0]];
}

/**
 * Artifact of a version identifier (`req-1-v2` → `req-1`). Rust
 * generates identifiers as `{artifact}-v{number}`; on shape mismatch,
 * null (the caller uses another source, never invents).
 */
export function artifactOfVersion(versionId: string): string | null {
  const match = /^(.*)-v\d+$/.exec(versionId.trim());
  if (match === null || match[1] === "") return null;
  return match[1];
}

// ---------------------------------------------------------------------------
// Semantic operations (all return a new spec).
// ---------------------------------------------------------------------------

/** Free identifier from a base (`step`, `step_2`, …). */
export function suggestId(base: string, taken: ReadonlySet<string>): string {
  const clean = base.trim() === "" ? "element" : base;
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}_${n}`)) n += 1;
  return `${clean}_${n}`;
}

const FLOW_LABELS: Record<FlowNodeKind, { id: string; label: string }> = {
  start: { id: "start", label: "Start" },
  step: { id: "step", label: "New step" },
  decision: { id: "decision", label: "New decision" },
  end: { id: "end", label: "End" },
};

/** Adds a node with a free identity. Touches neither edges nor layout. */
export function addFlowNode(spec: FlowSpec, kind: FlowNodeKind): { spec: FlowSpec; id: string } {
  const taken = new Set(spec.nodes.map((n) => n.id));
  const id = suggestId(FLOW_LABELS[kind].id, taken);
  return {
    spec: {
      ...spec,
      nodes: [
        ...spec.nodes,
        { id, kind, label: FLOW_LABELS[kind].label, requirements: [], mockups: [] },
      ],
    },
    id,
  };
}

export interface FlowNodePatch {
  label?: string;
  kind?: FlowNodeKind;
  requirements?: string[];
  mockups?: string[];
}

/** Edits a node label, kind or citations. Identity intact. */
export function updateFlowNode(spec: FlowSpec, id: string, patch: FlowNodePatch): FlowSpec {
  return {
    ...spec,
    nodes: spec.nodes.map((node) =>
      node.id === id
        ? {
            ...node,
            ...(patch.label !== undefined ? { label: patch.label } : {}),
            ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
            ...(patch.requirements !== undefined ? { requirements: patch.requirements } : {}),
            ...(patch.mockups !== undefined ? { mockups: patch.mockups } : {}),
          }
        : node,
    ),
  };
}

export interface RenameResult<T> {
  spec: T;
  ok: boolean;
  reason?: string;
}

function checkNewId(newId: string, taken: ReadonlySet<string>): string | null {
  if (newId.trim() === "") return "The identifier cannot be empty.";
  if (!/^[A-Za-z0-9_]+$/.test(newId)) {
    return "Only letters, digits and underscore.";
  }
  if (newId.length > 64) return "At most 64 characters.";
  if (taken.has(newId)) return "That identifier already exists.";
  return null;
}

/**
 * Renames a node identity and rewrites the edges citing it. Rejects
 * (changing nothing) invalid or duplicate identifiers.
 */
export function renameFlowNodeId(
  spec: FlowSpec,
  oldId: string,
  newId: string,
): RenameResult<FlowSpec> {
  if (oldId === newId) return { spec, ok: true };
  const problem = checkNewId(
    newId,
    new Set(spec.nodes.map((n) => n.id).filter((id) => id !== oldId)),
  );
  if (problem !== null) return { spec, ok: false, reason: problem };
  return {
    spec: {
      nodes: spec.nodes.map((node) => (node.id === oldId ? { ...node, id: newId } : node)),
      edges: spec.edges.map((edge) => ({
        ...edge,
        from: edge.from === oldId ? newId : edge.from,
        to: edge.to === oldId ? newId : edge.to,
      })),
    },
    ok: true,
  };
}

/** Removes a node and the edges touching it. Reports how many fell. */
export function removeFlowNode(spec: FlowSpec, id: string): { spec: FlowSpec; removedEdges: number } {
  const edges = spec.edges.filter((e) => e.from !== id && e.to !== id);
  return {
    spec: { nodes: spec.nodes.filter((n) => n.id !== id), edges },
    removedEdges: spec.edges.length - edges.length,
  };
}

/** Creates a connection. Cycles are valid in the subset. */
export function addFlowEdge(spec: FlowSpec, from: string, to: string): { spec: FlowSpec; index: number } {
  return {
    spec: { ...spec, edges: [...spec.edges, { from, to }] },
    index: spec.edges.length,
  };
}

/** Edits a connection label (`null` removes it). */
export function updateFlowEdge(
  spec: FlowSpec,
  index: number,
  label: string | null,
): FlowSpec {
  return {
    ...spec,
    edges: spec.edges.map((edge, i) =>
      i === index
        ? label === null
          ? { from: edge.from, to: edge.to }
          : { ...edge, label }
        : edge,
    ),
  };
}

/** Removes a connection by position. */
export function removeFlowEdge(spec: FlowSpec, index: number): FlowSpec {
  return { ...spec, edges: spec.edges.filter((_, i) => i !== index) };
}

/** Adds an entity with an initial attribute (the subset requires ≥1). */
export function addEntity(spec: ErSpec, name?: string): { spec: ErSpec; name: string } {
  const taken = new Set(spec.entities.map((e) => e.name));
  const base = name?.trim() === "" || name === undefined ? "Entity" : (name as string);
  const clean = /^[A-Za-z0-9_]+$/.test(base) ? base : "Entity";
  const finalName = suggestId(clean, taken);
  const attrTaken = new Set<string>();
  return {
    spec: {
      ...spec,
      entities: [
        ...spec.entities,
        {
          name: finalName,
          attributes: [{ name: suggestId("id", attrTaken), key: true }],
          requirements: [],
          mockups: [],
        },
      ],
    },
    name: finalName,
  };
}

/**
 * Renames an entity and rewrites the relations citing it. Rejects
 * (changing nothing) invalid or duplicate names.
 */
export function renameEntity(spec: ErSpec, oldName: string, newName: string): RenameResult<ErSpec> {
  if (oldName === newName) return { spec, ok: true };
  const problem = checkNewId(
    newName,
    new Set(spec.entities.map((e) => e.name).filter((name) => name !== oldName)),
  );
  if (problem !== null) return { spec, ok: false, reason: problem };
  return {
    spec: {
      entities: spec.entities.map((entity) =>
        entity.name === oldName ? { ...entity, name: newName } : entity,
      ),
      relations: spec.relations.map((relation) => ({
        ...relation,
        from: relation.from === oldName ? newName : relation.from,
        to: relation.to === oldName ? newName : relation.to,
      })),
    },
    ok: true,
  };
}

/** Removes an entity with its attributes and relations. Reports the falls. */
export function removeEntity(
  spec: ErSpec,
  name: string,
): { spec: ErSpec; removedAttributes: number; removedRelations: number } {
  const entity = spec.entities.find((e) => e.name === name);
  const relations = spec.relations.filter((r) => r.from !== name && r.to !== name);
  return {
    spec: {
      entities: spec.entities.filter((e) => e.name !== name),
      relations,
    },
    removedAttributes: entity?.attributes.length ?? 0,
    removedRelations: spec.relations.length - relations.length,
  };
}

/** Edits an entity requirement citations. */
export function setEntityRequirements(
  spec: ErSpec,
  name: string,
  requirements: string[],
): ErSpec {
  return {
    ...spec,
    entities: spec.entities.map((entity) =>
      entity.name === name ? { ...entity, requirements } : entity,
    ),
  };
}

/** Edits an entity mockup citations (`mockup/component`). */
export function setEntityMockups(spec: ErSpec, name: string, mockups: string[]): ErSpec {
  return {
    ...spec,
    entities: spec.entities.map((entity) =>
      entity.name === name ? { ...entity, mockups } : entity,
    ),
  };
}

/** Adds an attribute to an entity. */
export function addAttribute(
  spec: ErSpec,
  entity: string,
  name?: string,
): { spec: ErSpec; name: string | null } {
  const target = spec.entities.find((e) => e.name === entity);
  if (target === undefined) return { spec, name: null };
  const base = name?.trim() === "" || name === undefined ? "attribute" : (name as string);
  const clean = /^[A-Za-z0-9_]+$/.test(base) ? base : "attribute";
  const attrName = suggestId(clean, new Set(target.attributes.map((a) => a.name)));
  return {
    spec: {
      ...spec,
      entities: spec.entities.map((e) =>
        e.name === entity
          ? { ...e, attributes: [...e.attributes, { name: attrName, key: false }] }
          : e,
      ),
    },
    name: attrName,
  };
}

/** Renames an attribute inside its entity. */
export function renameAttribute(
  spec: ErSpec,
  entity: string,
  oldName: string,
  newName: string,
): RenameResult<ErSpec> {
  if (oldName === newName) return { spec, ok: true };
  const target = spec.entities.find((e) => e.name === entity);
  if (target === undefined) return { spec, ok: false, reason: "The entity does not exist." };
  const problem = checkNewId(
    newName,
    new Set(target.attributes.map((a) => a.name).filter((name) => name !== oldName)),
  );
  if (problem !== null) return { spec, ok: false, reason: problem };
  return {
    spec: {
      ...spec,
      entities: spec.entities.map((e) =>
        e.name === entity
          ? {
              ...e,
              attributes: e.attributes.map((a) =>
                a.name === oldName ? { ...a, name: newName } : a,
              ),
            }
          : e,
      ),
    },
    ok: true,
  };
}

/** Marks or unmarks an attribute as key (PK). */
export function setAttributeKey(
  spec: ErSpec,
  entity: string,
  name: string,
  key: boolean,
): ErSpec {
  return {
    ...spec,
    entities: spec.entities.map((e) =>
      e.name === entity
        ? {
            ...e,
            attributes: e.attributes.map((a) => (a.name === name ? { ...a, key } : a)),
          }
        : e,
    ),
  };
}

/** Removes an attribute from its entity. */
export function removeAttribute(spec: ErSpec, entity: string, name: string): ErSpec {
  return {
    ...spec,
    entities: spec.entities.map((e) =>
      e.name === entity ? { ...e, attributes: e.attributes.filter((a) => a.name !== name) } : e,
    ),
  };
}

/**
 * Creates a relation with permissive default cardinalities (N:N); the
 * inspector adjusts them. A self-relation is also valid in ER.
 */
export function addRelation(
  spec: ErSpec,
  from: string,
  to: string,
): { spec: ErSpec; index: number } {
  return {
    spec: {
      ...spec,
      relations: [...spec.relations, { from, to, fromCard: "0..N", toCard: "0..N" }],
    },
    index: spec.relations.length,
  };
}

export interface RelationPatch {
  label?: string | null;
  fromCard?: Cardinality;
  toCard?: Cardinality;
}

/** Edits a relation label (`null` removes it) or cardinalities. */
export function updateRelation(spec: ErSpec, index: number, patch: RelationPatch): ErSpec {
  return {
    ...spec,
    relations: spec.relations.map((relation, i) => {
      if (i !== index) return relation;
      const next = { ...relation };
      if (patch.label !== undefined) {
        if (patch.label === null) delete next.label;
        else next.label = patch.label;
      }
      if (patch.fromCard !== undefined) next.fromCard = patch.fromCard;
      if (patch.toCard !== undefined) next.toCard = patch.toCard;
      return next;
    }),
  };
}

/** Removes a relation by position. */
export function removeRelation(spec: ErSpec, index: number): ErSpec {
  return { ...spec, relations: spec.relations.filter((_, i) => i !== index) };
}

/** Edits the design title, explanation or questions. */
export function updateMeta(meta: DesignMeta, patch: Partial<DesignMeta>): DesignMeta {
  return { ...meta, ...patch };
}

/** Readable consequences of deleting a flow node. */
export function flowDeleteConsequences(spec: FlowSpec, id: string): string[] {
  const edges = spec.edges.filter((e) => e.from === id || e.to === id).length;
  const out = [`Deletes node "${id}".`];
  if (edges === 1) out.push("Deletes 1 connection touching it.");
  else if (edges > 1) out.push(`Deletes ${edges} connections touching it.`);
  const node = spec.nodes.find((n) => n.id === id);
  if (node !== undefined && (node.requirements.length > 0 || node.mockups.length > 0)) {
    out.push("Its citations disappear with it (requirements and mockups unchanged).");
  }
  return out;
}

/** Readable consequences of deleting an entity. */
export function erDeleteConsequences(spec: ErSpec, name: string): string[] {
  const entity = spec.entities.find((e) => e.name === name);
  const relations = spec.relations.filter((r) => r.from === name || r.to === name).length;
  const out = [`Deletes entity "${name}".`];
  const attrs = entity?.attributes.length ?? 0;
  if (attrs === 1) out.push("Deletes 1 attribute.");
  else if (attrs > 1) out.push(`Deletes ${attrs} attributes.`);
  if (relations === 1) out.push("Deletes 1 relation touching it.");
  else if (relations > 1) out.push(`Deletes ${relations} relations touching it.`);
  if (entity !== undefined && (entity.requirements.length > 0 || entity.mockups.length > 0)) {
    out.push("Its citations disappear with it (requirements and mockups unchanged).");
  }
  return out;
}
