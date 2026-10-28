// Validación ORIENTATIVA del borrador en el editor. Pura: sin React.
// La autoridad es Rust (`core_save_design_version` revalida todo al
// guardar); esto solo guía a la persona mientras edita, sin bloquear la
// exploración: los errores impiden guardar, los avisos solo informan.
//
// Topes duplicados de `src-tauri/crates/meta/src/design.rs`. Si cambian
// allí, Rust manda y esto se actualiza para no mentir.
import type { DesignKind } from "../types";
import type { DesignMeta, ErSpec, FlowSpec } from "./specModel";

export const MAX_ID_CHARS = 64;
export const MAX_LABEL_CHARS = 160;
export const MAX_TITLE_CHARS = 200;
export const MAX_EXPLANATION_CHARS = 2000;
export const MAX_QUESTIONS = 5;
export const MAX_QUESTION_CHARS = 1000;
export const MAX_REFS = 8;
export const MAX_FLOW_NODES = 24;
export const MAX_FLOW_EDGES = 40;
export const MAX_ER_ENTITIES = 16;
export const MAX_ER_ATTRIBUTES = 12;
export const MAX_ER_RELATIONS = 24;

export interface SpecIssue {
  code: string;
  message: string;
  /** Identificador del elemento implicado, si aplica. */
  element?: string;
}

export interface SpecValidation {
  errors: SpecIssue[];
  warnings: SpecIssue[];
}

function validId(id: string): boolean {
  const clean = id.trim();
  return (
    clean !== "" &&
    clean.length <= MAX_ID_CHARS &&
    /^[A-Za-z0-9_]+$/.test(clean)
  );
}

function checkMeta(meta: DesignMeta, issues: SpecIssue[]): void {
  const title = meta.title.trim();
  if (title === "") issues.push({ code: "title", message: "El diseño necesita un título." });
  else if (title.length > MAX_TITLE_CHARS) {
    issues.push({ code: "title", message: `Título excesivo (máximo ${MAX_TITLE_CHARS}).` });
  }
  const explanation = meta.explanation.trim();
  if (explanation === "") {
    issues.push({ code: "explanation", message: "El diseño necesita una explicación breve." });
  } else if (explanation.length > MAX_EXPLANATION_CHARS) {
    issues.push({
      code: "explanation",
      message: `Explicación excesiva (máximo ${MAX_EXPLANATION_CHARS}).`,
    });
  }
  if (meta.questions.length > MAX_QUESTIONS) {
    issues.push({
      code: "questions",
      message: `Demasiadas preguntas (máximo ${MAX_QUESTIONS}).`,
    });
  }
  meta.questions.forEach((question, i) => {
    const clean = question.trim();
    if (clean === "" || clean.length > MAX_QUESTION_CHARS) {
      issues.push({ code: "questions", message: `Pregunta ${i + 1} vacía o excesiva.` });
    }
  });
}

function checkRefs(
  refs: string[],
  allowed: ReadonlySet<string>,
  what: string,
  element: string,
  issues: SpecIssue[],
): void {
  if (refs.length > MAX_REFS) {
    issues.push({
      code: "refs",
      element,
      message: `${what}: demasiadas citas (máximo ${MAX_REFS}).`,
    });
  }
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!allowed.has(ref.trim())) {
      issues.push({
        code: "refs",
        element,
        message: `${what}: «${ref}» está fuera del conjunto de fuentes.`,
      });
    } else if (seen.has(ref)) {
      issues.push({ code: "refs", element, message: `${what}: cita duplicada «${ref}».` });
    }
    seen.add(ref);
  }
}

function validateFlow(spec: FlowSpec, meta: DesignMeta, allowed: ReadonlySet<string>): SpecValidation {
  const errors: SpecIssue[] = [];
  const warnings: SpecIssue[] = [];
  checkMeta(meta, errors);
  if (spec.nodes.length === 0 || spec.nodes.length > MAX_FLOW_NODES) {
    errors.push({
      code: "nodes",
      message: `El flujo debe tener entre 1 y ${MAX_FLOW_NODES} nodos.`,
    });
  }
  if (spec.edges.length > MAX_FLOW_EDGES) {
    errors.push({
      code: "edges",
      message: `Demasiadas conexiones (máximo ${MAX_FLOW_EDGES}).`,
    });
  }
  const seen = new Set<string>();
  for (const node of spec.nodes) {
    if (!validId(node.id)) {
      errors.push({
        code: "node-id",
        element: node.id,
        message: `Nodo «${node.id}»: identificador inválido (letras, dígitos, subrayado).`,
      });
    } else if (seen.has(node.id)) {
      errors.push({
        code: "node-id",
        element: node.id,
        message: `Nodo duplicado «${node.id}».`,
      });
    }
    seen.add(node.id);
    const label = node.label.trim();
    if (label === "" || label.length > MAX_LABEL_CHARS) {
      errors.push({
        code: "node-label",
        element: node.id,
        message: `Nodo «${node.id}»: etiqueta vacía o excesiva.`,
      });
    }
    checkRefs(node.requirements, allowed, `Nodo «${node.id}»`, node.id, errors);
  }
  const ids = new Set(spec.nodes.map((n) => n.id));
  spec.edges.forEach((edge, i) => {
    const what = `Conexión ${i + 1}`;
    if (!ids.has(edge.from)) {
      errors.push({ code: "edge", message: `${what}: origen inexistente «${edge.from}».` });
    }
    if (!ids.has(edge.to)) {
      errors.push({ code: "edge", message: `${what}: destino inexistente «${edge.to}».` });
    }
    if (edge.label !== undefined) {
      const label = edge.label.trim();
      if (label === "" || label.length > MAX_LABEL_CHARS) {
        errors.push({ code: "edge", message: `${what}: etiqueta vacía o excesiva.` });
      }
    }
  });
  // Avisos estructurales: orientan sin prohibir (los ciclos son válidos).
  if (spec.nodes.length > 0) {
    const kinds = new Set(spec.nodes.map((n) => n.kind));
    if (!kinds.has("start")) {
      warnings.push({ code: "no-start", message: "El flujo no tiene inicio." });
    }
    if (!kinds.has("end")) {
      warnings.push({ code: "no-end", message: "El flujo no tiene fin." });
    }
    const incoming = new Map<string, number>();
    for (const node of spec.nodes) incoming.set(node.id, 0);
    for (const edge of spec.edges) {
      if (incoming.has(edge.to)) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }
    const reachable = new Set<string>();
    const queue = spec.nodes
      .filter((n) => (incoming.get(n.id) ?? 0) === 0 || n.kind === "start")
      .map((n) => n.id);
    // Sin puntos de entrada (p. ej. un ciclo puro), los avisos de
    // inicio/fin ya cubren el caso: no se repite por nodo.
    const hasEntries = queue.length > 0;
    const outgoing = new Map<string, string[]>();
    for (const edge of spec.edges) {
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from)?.push(edge.to);
    }
    for (const id of queue) reachable.add(id);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      for (const next of outgoing.get(id) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    for (const node of spec.nodes) {
      if (!hasEntries) break;
      if (!reachable.has(node.id)) {
        warnings.push({
          code: "unreachable",
          element: node.id,
          message: `«${node.id}» no se alcanza desde ningún inicio.`,
        });
      }
    }
    for (const node of spec.nodes) {
      if (node.kind !== "decision") continue;
      const out = spec.edges.filter((e) => e.from === node.id).length;
      if (out < 2) {
        warnings.push({
          code: "decision",
          element: node.id,
          message: `La decisión «${node.id}» tiene menos de 2 ramas.`,
        });
      }
    }
  }
  return { errors, warnings };
}

function validateEr(spec: ErSpec, meta: DesignMeta, allowed: ReadonlySet<string>): SpecValidation {
  const errors: SpecIssue[] = [];
  const warnings: SpecIssue[] = [];
  checkMeta(meta, errors);
  if (spec.entities.length === 0 || spec.entities.length > MAX_ER_ENTITIES) {
    errors.push({
      code: "entities",
      message: `El modelo debe tener entre 1 y ${MAX_ER_ENTITIES} entidades.`,
    });
  }
  if (spec.relations.length > MAX_ER_RELATIONS) {
    errors.push({
      code: "relations",
      message: `Demasiadas relaciones (máximo ${MAX_ER_RELATIONS}).`,
    });
  }
  const seen = new Set<string>();
  for (const entity of spec.entities) {
    if (!validId(entity.name)) {
      errors.push({
        code: "entity-name",
        element: entity.name,
        message: `Entidad «${entity.name}»: nombre inválido (letras, dígitos, subrayado).`,
      });
    } else if (seen.has(entity.name)) {
      errors.push({
        code: "entity-name",
        element: entity.name,
        message: `Entidad duplicada «${entity.name}».`,
      });
    }
    seen.add(entity.name);
    if (entity.attributes.length === 0 || entity.attributes.length > MAX_ER_ATTRIBUTES) {
      errors.push({
        code: "attributes",
        element: entity.name,
        message: `«${entity.name}»: entre 1 y ${MAX_ER_ATTRIBUTES} atributos.`,
      });
    }
    const seenAttrs = new Set<string>();
    for (const attr of entity.attributes) {
      if (!validId(attr.name)) {
        errors.push({
          code: "attribute",
          element: entity.name,
          message: `«${entity.name}»: atributo inválido «${attr.name}».`,
        });
      } else if (seenAttrs.has(attr.name)) {
        errors.push({
          code: "attribute",
          element: entity.name,
          message: `«${entity.name}»: atributo duplicado «${attr.name}».`,
        });
      }
      seenAttrs.add(attr.name);
    }
    checkRefs(entity.requirements, allowed, `Entidad «${entity.name}»`, entity.name, errors);
  }
  const names = new Set(spec.entities.map((e) => e.name));
  const cards = new Set(["1", "0..1", "N", "0..N"]);
  spec.relations.forEach((relation, i) => {
    const what = `Relación ${i + 1}`;
    if (!names.has(relation.from)) {
      errors.push({ code: "relation", message: `${what}: origen inexistente «${relation.from}».` });
    }
    if (!names.has(relation.to)) {
      errors.push({ code: "relation", message: `${what}: destino inexistente «${relation.to}».` });
    }
    if (relation.label !== undefined) {
      const label = relation.label.trim();
      if (label === "" || label.length > MAX_LABEL_CHARS) {
        errors.push({ code: "relation", message: `${what}: etiqueta vacía o excesiva.` });
      }
    }
    if (!cards.has(relation.fromCard) || !cards.has(relation.toCard)) {
      errors.push({ code: "relation", message: `${what}: cardinalidad no admitida.` });
    }
  });
  // Avisos orientativos.
  for (const entity of spec.entities) {
    if (entity.attributes.length > 0 && !entity.attributes.some((a) => a.key)) {
      warnings.push({
        code: "no-key",
        element: entity.name,
        message: `«${entity.name}» no marca ningún atributo como clave.`,
      });
    }
    const touched = spec.relations.some((r) => r.from === entity.name || r.to === entity.name);
    if (!touched && spec.entities.length > 1) {
      warnings.push({
        code: "isolated",
        element: entity.name,
        message: `«${entity.name}» no tiene relaciones.`,
      });
    }
  }
  return { errors, warnings };
}

/**
 * Valida el borrador contra el subconjunto y el conjunto permitido
 * (artefactos de las fuentes declaradas). Orientativa: Rust decide.
 */
export function validateDraft(
  kind: DesignKind,
  spec: FlowSpec | ErSpec,
  meta: DesignMeta,
  allowed: string[],
): SpecValidation {
  const set = new Set(allowed);
  return kind === "flow"
    ? validateFlow(spec as FlowSpec, meta, set)
    : validateEr(spec as ErSpec, meta, set);
}
