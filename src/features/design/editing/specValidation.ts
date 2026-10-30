// ORIENTATIVE draft validation in the editor. Pure: no React. The
// authority is Rust (`core_save_design_version` revalidates everything
// on save); this only guides the person while editing, without blocking
// exploration: errors prevent saving, warnings only inform. Limits
// duplicated from `src-tauri/crates/meta/src/design.rs`. When they
// change there, Rust wins and this is updated to avoid lying.
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
  /** Identifier of the element involved, when it applies. */
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
  if (title === "") issues.push({ code: "title", message: "The design needs a title." });
  else if (title.length > MAX_TITLE_CHARS) {
    issues.push({ code: "title", message: `Title too long (at most ${MAX_TITLE_CHARS}).` });
  }
  const explanation = meta.explanation.trim();
  if (explanation === "") {
    issues.push({ code: "explanation", message: "The design needs a brief explanation." });
  } else if (explanation.length > MAX_EXPLANATION_CHARS) {
    issues.push({
      code: "explanation",
      message: `Explanation too long (at most ${MAX_EXPLANATION_CHARS}).`,
    });
  }
  if (meta.questions.length > MAX_QUESTIONS) {
    issues.push({
      code: "questions",
      message: `Too many questions (at most ${MAX_QUESTIONS}).`,
    });
  }
  meta.questions.forEach((question, i) => {
    const clean = question.trim();
    if (clean === "" || clean.length > MAX_QUESTION_CHARS) {
      issues.push({ code: "questions", message: `Question ${i + 1} empty or too long.` });
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
      message: `${what}: too many citations (at most ${MAX_REFS}).`,
    });
  }
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!allowed.has(ref.trim())) {
      issues.push({
        code: "refs",
        element,
        message: `${what}: "${ref}" is outside the source set.`,
      });
    } else if (seen.has(ref)) {
      issues.push({ code: "refs", element, message: `${what}: duplicate citation "${ref}".` });
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
      message: `The flow must have between 1 and ${MAX_FLOW_NODES} nodes.`,
    });
  }
  if (spec.edges.length > MAX_FLOW_EDGES) {
    errors.push({
      code: "edges",
      message: `Too many connections (at most ${MAX_FLOW_EDGES}).`,
    });
  }
  const seen = new Set<string>();
  for (const node of spec.nodes) {
    if (!validId(node.id)) {
      errors.push({
        code: "node-id",
        element: node.id,
        message: `Node "${node.id}": invalid identifier (letters, digits, underscore).`,
      });
    } else if (seen.has(node.id)) {
      errors.push({
        code: "node-id",
        element: node.id,
        message: `Duplicate node "${node.id}".`,
      });
    }
    seen.add(node.id);
    const label = node.label.trim();
    if (label === "" || label.length > MAX_LABEL_CHARS) {
      errors.push({
        code: "node-label",
        element: node.id,
        message: `Node "${node.id}": empty or too long label.`,
      });
    }
    checkRefs(node.requirements, allowed, `Node "${node.id}"`, node.id, errors);
  }
  const ids = new Set(spec.nodes.map((n) => n.id));
  spec.edges.forEach((edge, i) => {
    const what = `Connection ${i + 1}`;
    if (!ids.has(edge.from)) {
      errors.push({ code: "edge", message: `${what}: missing origin "${edge.from}".` });
    }
    if (!ids.has(edge.to)) {
      errors.push({ code: "edge", message: `${what}: missing target "${edge.to}".` });
    }
    if (edge.label !== undefined) {
      const label = edge.label.trim();
      if (label === "" || label.length > MAX_LABEL_CHARS) {
        errors.push({ code: "edge", message: `${what}: empty or too long label.` });
      }
    }
  });
  // Structural warnings: they guide without forbidding (cycles are valid).
  if (spec.nodes.length > 0) {
    const kinds = new Set(spec.nodes.map((n) => n.kind));
    if (!kinds.has("start")) {
      warnings.push({ code: "no-start", message: "The flow has no start." });
    }
    if (!kinds.has("end")) {
      warnings.push({ code: "no-end", message: "The flow has no end." });
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
    // Without entry points (e.g. a pure cycle), the start/end
    // warnings already cover the case: no per-node repeat.
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
          message: `"${node.id}" is not reachable from any start.`,
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
          message: `Decision "${node.id}" has fewer than 2 branches.`,
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
      message: `The model must have between 1 and ${MAX_ER_ENTITIES} entities.`,
    });
  }
  if (spec.relations.length > MAX_ER_RELATIONS) {
    errors.push({
      code: "relations",
      message: `Too many relations (at most ${MAX_ER_RELATIONS}).`,
    });
  }
  const seen = new Set<string>();
  for (const entity of spec.entities) {
    if (!validId(entity.name)) {
      errors.push({
        code: "entity-name",
        element: entity.name,
        message: `Entity "${entity.name}": invalid name (letters, digits, underscore).`,
      });
    } else if (seen.has(entity.name)) {
      errors.push({
        code: "entity-name",
        element: entity.name,
        message: `Duplicate entity "${entity.name}".`,
      });
    }
    seen.add(entity.name);
    if (entity.attributes.length === 0 || entity.attributes.length > MAX_ER_ATTRIBUTES) {
      errors.push({
        code: "attributes",
        element: entity.name,
        message: `"${entity.name}": between 1 and ${MAX_ER_ATTRIBUTES} attributes.`,
      });
    }
    const seenAttrs = new Set<string>();
    for (const attr of entity.attributes) {
      if (!validId(attr.name)) {
        errors.push({
          code: "attribute",
          element: entity.name,
          message: `"${entity.name}": invalid attribute "${attr.name}".`,
        });
      } else if (seenAttrs.has(attr.name)) {
        errors.push({
          code: "attribute",
          element: entity.name,
          message: `"${entity.name}": duplicate attribute "${attr.name}".`,
        });
      }
      seenAttrs.add(attr.name);
    }
    checkRefs(entity.requirements, allowed, `Entity "${entity.name}"`, entity.name, errors);
  }
  const names = new Set(spec.entities.map((e) => e.name));
  const cards = new Set(["1", "0..1", "N", "0..N"]);
  spec.relations.forEach((relation, i) => {
    const what = `Relation ${i + 1}`;
    if (!names.has(relation.from)) {
      errors.push({ code: "relation", message: `${what}: missing origin "${relation.from}".` });
    }
    if (!names.has(relation.to)) {
      errors.push({ code: "relation", message: `${what}: missing target "${relation.to}".` });
    }
    if (relation.label !== undefined) {
      const label = relation.label.trim();
      if (label === "" || label.length > MAX_LABEL_CHARS) {
        errors.push({ code: "relation", message: `${what}: empty or too long label.` });
      }
    }
    if (!cards.has(relation.fromCard) || !cards.has(relation.toCard)) {
      errors.push({ code: "relation", message: `${what}: unsupported cardinality.` });
    }
  });
  // Orientative warnings.
  for (const entity of spec.entities) {
    if (entity.attributes.length > 0 && !entity.attributes.some((a) => a.key)) {
      warnings.push({
        code: "no-key",
        element: entity.name,
        message: `"${entity.name}" marks no attribute as key.`,
      });
    }
    const touched = spec.relations.some((r) => r.from === entity.name || r.to === entity.name);
    if (!touched && spec.entities.length > 1) {
      warnings.push({
        code: "isolated",
        element: entity.name,
        message: `"${entity.name}" has no relations.`,
      });
    }
  }
  return { errors, warnings };
}

/**
 * Validates the draft against the subset and the allowed set
 * (artifacts of the declared sources). Orientative: Rust decides.
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
