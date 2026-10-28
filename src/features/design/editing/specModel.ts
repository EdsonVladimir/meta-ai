// Modelo semántico del editor visual de diseños. Puro: sin React, sin
// Tauri. El JSON estructurado sigue siendo autoritativo; este módulo lo
// parsea, lo transforma con operaciones totales y lo serializa en forma
// canónica. Las posiciones visuales NO viven aquí (ver Layout): mover un
// elemento jamás toca la semántica.
//
// Refleja el subconjunto de `src-tauri/crates/meta/src/design.rs`:
// - Flujo: nodos start|step|decision|end con id/etiqueta/citas, aristas con
//   origen/destino/etiqueta opcional. Los ciclos son válidos.
// - ER: entidades con nombre/atributos (nombre + marca de clave, SIN tipos:
//   fuera del subconjunto) y citas; relaciones con extremos, etiqueta
//   opcional y cardinalidades 1|0..1|N|0..N.
// Las referencias a requisitos son identificadores de ARTEFACTO estables.

export type FlowNodeKind = "start" | "step" | "decision" | "end";
export type Cardinality = "1" | "0..1" | "N" | "0..N";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  requirements: string[];
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
 * Disposición visual: posiciones (y tamaño opcional) por identificador de
 * elemento. `w`/`h` solo los usan los mockups redimensionables; los
 * diagramas guardan posición y los ignoran.
 */
export type Layout = Record<string, { x: number; y: number; w?: number; h?: number }>;

/** Nodo listo para el lienzo: semántica + posición resuelta. */
export interface CanvasNode<T> {
  id: string;
  x: number;
  y: number;
  data: T;
}

export interface CanvasEdge {
  /** Identidad posicional (`e0`, `e1`…): las aristas no tienen id propio. */
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

/** Parsea un flujo guardado (contenido canónico). Null ante forma ajena. */
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
    nodes.push({ id: raw.id, kind: raw.kind as FlowNodeKind, label: raw.label, requirements });
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

/** Parsea un modelo ER guardado (contenido canónico). Null ante forma ajena. */
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
    const attributes: ErAttribute[] = [];
    for (const attr of raw.attributes) {
      if (!isRecord(attr)) return null;
      if (typeof attr.name !== "string") return null;
      if (attr.key !== undefined && typeof attr.key !== "boolean") return null;
      attributes.push({ name: attr.name, key: attr.key === true });
    }
    entities.push({ name: raw.name, attributes, requirements });
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

/** Serialización canónica: mismo orden de claves que Rust (`title`, `kind`, …). */
export function serializeFlowSpec(spec: FlowSpec, meta: DesignMeta): string {
  return JSON.stringify({
    title: meta.title,
    kind: "flow",
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      requirements: n.requirements,
    })),
    edges: spec.edges.map((e) => (e.label === undefined ? { from: e.from, to: e.to } : e)),
    explanation: meta.explanation,
    questions: meta.questions,
  });
}

/** Serialización canónica del modelo ER. */
export function serializeErSpec(spec: ErSpec, meta: DesignMeta): string {
  return JSON.stringify({
    title: meta.title,
    kind: "data_model",
    entities: spec.entities.map((e) => ({
      name: e.name,
      attributes: e.attributes.map((a) => ({ name: a.name, key: a.key })),
      requirements: e.requirements,
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

/** Interpreta una disposición guardada con tolerancia: solo entradas válidas. */
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
// Trazado automático determinista (solo cuando no hay disposición guardada).
// ---------------------------------------------------------------------------

const FLOW_DX = 240;
const FLOW_DY = 130;
const ER_DX = 300;
const ER_DY = 230;

/**
 * Capas por anchura desde las raíces (sin entrantes), estable en el orden
 * de la especificación. Seguro ante ciclos: lo no alcanzado cae al final.
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
    // Todo en ciclos: se empieza por el primero sin romper determinismo.
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

/** Flujo → lienzo: la disposición manda; lo demás usa trazado automático. */
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
 * Vértice de salida para cada arista cuyo origen es una decisión (solo
 * presentación: los ids corresponden a los handles del rombo). Regla
 * determinista en el orden de la especificación: una sola rama sale por
 * abajo; con dos o más, la primera por la derecha, la segunda por la
 * izquierda y el resto por abajo. `null` = handle por defecto.
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

/** ER → lienzo: rejilla estable en el orden de la especificación. */
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

/** Al renombrar un elemento, su posición guardada lo acompaña. */
export function remapLayout(layout: Layout, oldId: string, newId: string): Layout {
  if (oldId === newId || layout[oldId] === undefined) return layout;
  const next = { ...layout };
  next[newId] = next[oldId];
  delete next[oldId];
  return next;
}

/**
 * Detecta un renombrado único entre dos especificaciones ([viejo, nuevo]).
 * El editor lo usa para acompañar la posición guardada. Null si hubo
 * altas/bajas o varios cambios (la disposición parcial se conserva igual:
 * lo desconocido cae al trazado automático).
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
 * Artefacto de un identificador de versión (`req-1-v2` → `req-1`). Los
 * identificadores los genera Rust como `{artefacto}-v{número}`; si la forma
 * no coincide, null (el llamante usa otra fuente, nunca inventa).
 */
export function artifactOfVersion(versionId: string): string | null {
  const match = /^(.*)-v\d+$/.exec(versionId.trim());
  if (match === null || match[1] === "") return null;
  return match[1];
}

// ---------------------------------------------------------------------------
// Operaciones semánticas (todas devuelven una especificación nueva).
// ---------------------------------------------------------------------------

/** Identificador libre a partir de una base (`paso`, `paso_2`, …). */
export function suggestId(base: string, taken: ReadonlySet<string>): string {
  const clean = base.trim() === "" ? "elemento" : base;
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}_${n}`)) n += 1;
  return `${clean}_${n}`;
}

const FLOW_LABELS: Record<FlowNodeKind, { id: string; label: string }> = {
  start: { id: "inicio", label: "Inicio" },
  step: { id: "paso", label: "Nuevo paso" },
  decision: { id: "decision", label: "Nueva decisión" },
  end: { id: "fin", label: "Fin" },
};

/** Añade un nodo con identidad libre. No toca aristas ni disposición. */
export function addFlowNode(spec: FlowSpec, kind: FlowNodeKind): { spec: FlowSpec; id: string } {
  const taken = new Set(spec.nodes.map((n) => n.id));
  const id = suggestId(FLOW_LABELS[kind].id, taken);
  return {
    spec: {
      ...spec,
      nodes: [
        ...spec.nodes,
        { id, kind, label: FLOW_LABELS[kind].label, requirements: [] },
      ],
    },
    id,
  };
}

export interface FlowNodePatch {
  label?: string;
  kind?: FlowNodeKind;
  requirements?: string[];
}

/** Edita etiqueta, tipo o citas de un nodo. Identidad intacta. */
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
  if (newId.trim() === "") return "El identificador no puede estar vacío.";
  if (!/^[A-Za-z0-9_]+$/.test(newId)) {
    return "Solo letras, dígitos y subrayado.";
  }
  if (newId.length > 64) return "Máximo 64 caracteres.";
  if (taken.has(newId)) return "Ese identificador ya existe.";
  return null;
}

/**
 * Renombra la identidad de un nodo y reescribe las aristas que lo citan.
 * Rechaza (sin cambiar nada) identificadores inválidos o duplicados.
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

/** Elimina un nodo y las aristas que lo tocan. Informa cuántas cayeron. */
export function removeFlowNode(spec: FlowSpec, id: string): { spec: FlowSpec; removedEdges: number } {
  const edges = spec.edges.filter((e) => e.from !== id && e.to !== id);
  return {
    spec: { nodes: spec.nodes.filter((n) => n.id !== id), edges },
    removedEdges: spec.edges.length - edges.length,
  };
}

/** Crea una conexión. Los ciclos son válidos en el subconjunto. */
export function addFlowEdge(spec: FlowSpec, from: string, to: string): { spec: FlowSpec; index: number } {
  return {
    spec: { ...spec, edges: [...spec.edges, { from, to }] },
    index: spec.edges.length,
  };
}

/** Edita la etiqueta de una conexión (`null` la quita). */
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

/** Elimina una conexión por su posición. */
export function removeFlowEdge(spec: FlowSpec, index: number): FlowSpec {
  return { ...spec, edges: spec.edges.filter((_, i) => i !== index) };
}

/** Añade una entidad con un atributo inicial (el subconjunto exige ≥1). */
export function addEntity(spec: ErSpec, name?: string): { spec: ErSpec; name: string } {
  const taken = new Set(spec.entities.map((e) => e.name));
  const base = name?.trim() === "" || name === undefined ? "Entidad" : (name as string);
  const clean = /^[A-Za-z0-9_]+$/.test(base) ? base : "Entidad";
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
        },
      ],
    },
    name: finalName,
  };
}

/**
 * Renombra una entidad y reescribe las relaciones que la citan. Rechaza
 * (sin cambiar nada) nombres inválidos o duplicados.
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

/** Elimina una entidad con sus atributos y relaciones. Informa las caídas. */
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

/** Edita las citas a requisitos de una entidad. */
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

/** Añade un atributo a una entidad. */
export function addAttribute(
  spec: ErSpec,
  entity: string,
  name?: string,
): { spec: ErSpec; name: string | null } {
  const target = spec.entities.find((e) => e.name === entity);
  if (target === undefined) return { spec, name: null };
  const base = name?.trim() === "" || name === undefined ? "atributo" : (name as string);
  const clean = /^[A-Za-z0-9_]+$/.test(base) ? base : "atributo";
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

/** Renombra un atributo dentro de su entidad. */
export function renameAttribute(
  spec: ErSpec,
  entity: string,
  oldName: string,
  newName: string,
): RenameResult<ErSpec> {
  if (oldName === newName) return { spec, ok: true };
  const target = spec.entities.find((e) => e.name === entity);
  if (target === undefined) return { spec, ok: false, reason: "La entidad no existe." };
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

/** Marca o desmarca un atributo como clave (PK). */
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

/** Elimina un atributo de su entidad. */
export function removeAttribute(spec: ErSpec, entity: string, name: string): ErSpec {
  return {
    ...spec,
    entities: spec.entities.map((e) =>
      e.name === entity ? { ...e, attributes: e.attributes.filter((a) => a.name !== name) } : e,
    ),
  };
}

/**
 * Crea una relación con cardinalidades permisivas por defecto (N:N);
 * el inspector las ajusta. Una autorrelación también es válida en ER.
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

/** Edita etiqueta (`null` la quita) o cardinalidades de una relación. */
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

/** Elimina una relación por su posición. */
export function removeRelation(spec: ErSpec, index: number): ErSpec {
  return { ...spec, relations: spec.relations.filter((_, i) => i !== index) };
}

/** Edita título, explicación o preguntas del diseño. */
export function updateMeta(meta: DesignMeta, patch: Partial<DesignMeta>): DesignMeta {
  return { ...meta, ...patch };
}

/** Consecuencias legibles de eliminar un nodo de flujo. */
export function flowDeleteConsequences(spec: FlowSpec, id: string): string[] {
  const edges = spec.edges.filter((e) => e.from === id || e.to === id).length;
  const out = [`Elimina el nodo «${id}».`];
  if (edges === 1) out.push("Elimina 1 conexión que lo toca.");
  else if (edges > 1) out.push(`Elimina ${edges} conexiones que lo tocan.`);
  const node = spec.nodes.find((n) => n.id === id);
  if (node !== undefined && node.requirements.length > 0) {
    out.push("Sus citas a requisitos desaparecen con él (los requisitos no cambian).");
  }
  return out;
}

/** Consecuencias legibles de eliminar una entidad. */
export function erDeleteConsequences(spec: ErSpec, name: string): string[] {
  const entity = spec.entities.find((e) => e.name === name);
  const relations = spec.relations.filter((r) => r.from === name || r.to === name).length;
  const out = [`Elimina la entidad «${name}».`];
  const attrs = entity?.attributes.length ?? 0;
  if (attrs === 1) out.push("Elimina 1 atributo.");
  else if (attrs > 1) out.push(`Elimina ${attrs} atributos.`);
  if (relations === 1) out.push("Elimina 1 relación que la toca.");
  else if (relations > 1) out.push(`Elimina ${relations} relaciones que la tocan.`);
  if (entity !== undefined && entity.requirements.length > 0) {
    out.push("Sus citas a requisitos desaparecen con ella (los requisitos no cambian).");
  }
  return out;
}
