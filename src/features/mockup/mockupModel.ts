// Semantic model of the mockup editor. Pure: no React, no Tauri. The
// structured JSON stays authoritative; this module parses it, transforms
// it with total operations and serializes it canonically. Positions and
// sizes do NOT live here (see Layout): moving or resizing never touches
// semantics. Mirrors the `src-tauri/crates/meta/src/mockup.rs` subset:
// screens with identity and states, text|field|selector|button|table|
// container|icon components, mandatory data origin on field/selector/
// table, existing navigation targets and references within the declared
// set. Validation here is orientative; the authoritative one lives in
// Rust.
import type { Layout } from "../design/editing/specModel";
import { isMockupIcon } from "./mockupIcons";
import type {
  MockupActionKind,
  MockupButtonState,
  MockupComponent,
  MockupComponentKind,
  MockupDirection,
  MockupFieldType,
  MockupIconRole,
  MockupOrigin,
  MockupSpec,
} from "./types";

export type {
  MockupActionKind,
  MockupButtonState,
  MockupComponent,
  MockupComponentKind,
  MockupDirection,
  MockupFieldType,
  MockupIconRole,
  MockupOrigin,
  MockupScreen,
  MockupScreenState,
  MockupSpec,
} from "./types";

export const MAX_MOCKUP_SCREENS = 12;
export const MAX_MOCKUP_COMPONENTS = 40;
export const MAX_MOCKUP_OPTIONS = 24;
export const MAX_MOCKUP_COLUMNS = 12;
export const MAX_MOCKUP_TITLE = 200;
export const MAX_MOCKUP_LABEL = 160;
export const MAX_MOCKUP_TEXT = 1000;
export const MAX_MOCKUP_VALIDATION = 500;
export const MAX_MOCKUP_REFS = 8;
export const MAX_MOCKUP_CHILDREN = 40;
export const MAX_MOCKUP_STATES = 8;
export const MAX_MOCKUP_VALIDATIONS = 8;
export const MAX_MOCKUP_PREVIEW_ROWS = 5;
export const MAX_MOCKUP_ROW_ACTIONS = 8;

export const COMPONENT_KINDS: MockupComponentKind[] = [
  "text",
  "field",
  "selector",
  "button",
  "table",
  "container",
  "icon",
];
export const FIELD_TYPES: MockupFieldType[] = ["text", "number", "date", "boolean"];
export const ORIGINS: MockupOrigin[] = [
  "persisted",
  "calculated",
  "temporary",
  "external",
  "undefined",
];
export const ACTION_KINDS: MockupActionKind[] = [
  "navigate",
  "submit",
  "open_dialog",
  "cancel",
  "business",
];
export const BUTTON_STATES: MockupButtonState[] = ["enabled", "disabled", "loading", "error"];
export const DIRECTIONS: MockupDirection[] = ["vertical", "horizontal"];
export const ICON_ROLES: MockupIconRole[] = ["decorative", "button", "indicator"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((item): item is string => typeof item === "string")) return null;
  return [...value];
}

function asKind(value: unknown): MockupComponentKind | null {
  return typeof value === "string" && (COMPONENT_KINDS as string[]).includes(value)
    ? (value as MockupComponentKind)
    : null;
}

function asFieldType(value: unknown): MockupFieldType | null {
  return typeof value === "string" && (FIELD_TYPES as string[]).includes(value)
    ? (value as MockupFieldType)
    : null;
}

function asOrigin(value: unknown): MockupOrigin | null {
  return typeof value === "string" && (ORIGINS as string[]).includes(value)
    ? (value as MockupOrigin)
    : null;
}

function asActionKind(value: unknown): MockupActionKind | null {
  return typeof value === "string" && (ACTION_KINDS as string[]).includes(value)
    ? (value as MockupActionKind)
    : null;
}

function asButtonState(value: unknown): MockupButtonState | null {
  return typeof value === "string" && (BUTTON_STATES as string[]).includes(value)
    ? (value as MockupButtonState)
    : null;
}

function asDirection(value: unknown): MockupDirection | null {
  return typeof value === "string" && (DIRECTIONS as string[]).includes(value)
    ? (value as MockupDirection)
    : null;
}

function asIconRole(value: unknown): MockupIconRole | null {
  return typeof value === "string" && (ICON_ROLES as string[]).includes(value)
    ? (value as MockupIconRole)
    : null;
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fieldTypeList(value: unknown): MockupFieldType[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: MockupFieldType[] = [];
  for (const item of value) {
    const parsed = asFieldType(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function stringMatrix(value: unknown): string[][] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) return null;
    if (!row.every((item): item is string => typeof item === "string")) return null;
    out.push([...row]);
  }
  return out;
}

/** Normalizes the legacy action like Rust (declarative or operation). */
function legacyAction(item: Record<string, unknown>): {
  actionKind?: MockupActionKind;
  operation?: string;
} {
  const kind = asActionKind(item.action_kind);
  const operation = optString(item.operation);
  if (kind !== null || operation !== undefined) {
    return {
      ...(kind !== null ? { actionKind: kind } : {}),
      ...(operation !== undefined ? { operation } : {}),
    };
  }
  if (typeof item.action !== "string") return {};
  const declared = asActionKind(item.action);
  if (declared !== null) return { actionKind: declared };
  return { operation: item.action };
}

/** Parses a saved mockup (canonical content). Null on foreign shape. */
export function parseMockupSpec(value: unknown): MockupSpec | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== "string") return null;
  if (!Array.isArray(value.screens)) return null;
  const screens: MockupSpec["screens"] = [];
  for (const raw of value.screens) {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || typeof raw.title !== "string") return null;
    const requirements = stringList(raw.requirements);
    const designs = stringList(raw.designs);
    if (requirements === null || designs === null) return null;
    const states = parseStates(raw.states);
    if (states === null) return null;
    if (!Array.isArray(raw.components)) return null;
    const components: MockupComponent[] = [];
    for (const item of raw.components) {
      if (!isRecord(item)) return null;
      if (typeof item.id !== "string") return null;
      const kind = asKind(item.kind);
      if (kind === null) return null;
      const creq = stringList(item.requirements);
      const cdes = stringList(item.designs);
      if (creq === null || cdes === null) return null;
      const options = stringList(item.options);
      const columns = stringList(item.columns);
      const validations = parseValidations(item);
      const columnTypes = fieldTypeList(item.column_types);
      const previewRows = stringMatrix(item.preview_rows);
      const rowActions = stringList(item.row_actions);
      const children = stringList(item.children);
      if (
        options === null ||
        columns === null ||
        validations === null ||
        columnTypes === null ||
        previewRows === null ||
        rowActions === null ||
        children === null
      ) {
        return null;
      }
      const action = legacyAction(item);
      const buttonState = asButtonState(item.button_state);
      const direction = asDirection(item.direction);
      const iconRole = asIconRole(item.icon_role);
      components.push({
        id: item.id,
        kind,
        text: optString(item.text),
        label: optString(item.label),
        name: optString(item.name),
        fieldType: asFieldType(item.field_type) ?? undefined,
        required: item.required === true,
        validations,
        dataRef: optString(item.data_ref),
        options,
        columns,
        columnTypes,
        previewRows,
        rowActions,
        ...action,
        target: optString(item.target),
        // Defaults normalize like in Rust so the draft compares clean
        // against the saved version.
        ...(buttonState !== null && buttonState !== "enabled" ? { buttonState } : {}),
        origin: asOrigin(item.origin) ?? undefined,
        icon: optString(item.icon),
        ...(iconRole !== null && iconRole !== "decorative" ? { iconRole } : {}),
        tooltip: optString(item.tooltip),
        children,
        ...(direction !== null && direction !== "vertical" ? { direction } : {}),
        requirements: creq,
        designs: cdes,
      });
    }
    screens.push({ id: raw.id, title: raw.title, requirements, designs, states, components });
  }
  return { title: value.title, screens };
}

function parseStates(value: unknown): MockupSpec["screens"][number]["states"] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: MockupSpec["screens"][number]["states"] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.id !== "string" || typeof item.label !== "string") return null;
    out.push({ id: item.id, label: item.label });
  }
  return out;
}

/** The new list wins; the legacy one (`validation`) adds one item. */
function parseValidations(item: Record<string, unknown>): string[] | null {
  if (item.validations !== undefined && item.validations !== null) {
    return stringList(item.validations);
  }
  const legacy = optString(item.validation);
  return legacy === undefined ? [] : [legacy];
}

/**
 * Canonical serialization: same key order and omissions as
 * `canonical_mockup_json` in Rust, so the draft comparison
 * (dirty/clean) matches the saved version. It serializes, not validates.
 */
export function canonicalMockup(spec: MockupSpec): string {
  return JSON.stringify({
    title: spec.title,
    kind: "mockup",
    screens: spec.screens.map((screen) => ({
      id: screen.id,
      title: screen.title,
      ...(screen.requirements.length > 0 ? { requirements: screen.requirements } : {}),
      ...(screen.designs.length > 0 ? { designs: screen.designs } : {}),
      ...(screen.states.length > 0 ? { states: screen.states } : {}),
      components: screen.components.map((c) => {
        const out: Record<string, unknown> = { id: c.id, kind: c.kind };
        if (c.text !== undefined) out.text = c.text;
        if (c.label !== undefined) out.label = c.label;
        if (c.name !== undefined) out.name = c.name;
        if (c.fieldType !== undefined) out.field_type = c.fieldType;
        if (c.required) out.required = true;
        if (c.validations.length > 0) out.validations = c.validations;
        if (c.dataRef !== undefined) out.data_ref = c.dataRef;
        if (c.options.length > 0) out.options = c.options;
        if (c.columns.length > 0) out.columns = c.columns;
        if (c.columnTypes.length > 0) out.column_types = c.columnTypes;
        if (c.previewRows.length > 0) out.preview_rows = c.previewRows;
        if (c.rowActions.length > 0) out.row_actions = c.rowActions;
        if (c.actionKind !== undefined) out.action_kind = c.actionKind;
        if (c.operation !== undefined) out.operation = c.operation;
        if (c.target !== undefined) out.target = c.target;
        if (c.buttonState !== undefined) out.button_state = c.buttonState;
        if (c.origin !== undefined) out.origin = c.origin;
        if (c.icon !== undefined) out.icon = c.icon;
        if (c.iconRole !== undefined) out.icon_role = c.iconRole;
        if (c.tooltip !== undefined) out.tooltip = c.tooltip;
        if (c.children.length > 0) out.children = c.children;
        if (c.direction !== undefined) out.direction = c.direction;
        if (c.requirements.length > 0) out.requirements = c.requirements;
        if (c.designs.length > 0) out.designs = c.designs;
        return out;
      }),
    })),
  });
}

/** Valid identifier? Letters, digits and underscore, 1–64. */
export function validMockupId(id: string): boolean {
  const trimmed = id.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 64 &&
    /^[A-Za-z0-9_]+$/.test(trimmed)
  );
}

/** Suggests a free identifier with a prefix (`field`, `field_2`…). */
export function suggestMockupId(prefix: string, used: Set<string>): string {
  const base = prefix.trim() === "" ? "e" : prefix;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Every component identifier in the mockup. */
export function componentIds(spec: MockupSpec): Set<string> {
  const ids = new Set<string>();
  for (const screen of spec.screens) {
    for (const component of screen.components) ids.add(component.id);
  }
  return ids;
}

/** Every screen identifier in the mockup. */
export function screenIds(spec: MockupSpec): Set<string> {
  return new Set(spec.screens.map((s) => s.id));
}

/**
 * Detects a single component rename between two specs (to carry its
 * layout over). Null unless there is exactly one.
 */
export function detectMockupRename(before: MockupSpec, after: MockupSpec): [string, string] | null {
  const oldIds = componentIds(before);
  const newIds = componentIds(after);
  if (oldIds.size !== newIds.size) return null;
  const gone = [...oldIds].filter((id) => !newIds.has(id));
  const fresh = [...newIds].filter((id) => !oldIds.has(id));
  if (gone.length !== 1 || fresh.length !== 1) return null;
  return [gone[0], fresh[0]];
}

function blankComponent(kind: MockupComponentKind, id: string): MockupComponent {
  return {
    id,
    kind,
    required: false,
    validations: [],
    options: [],
    columns: [],
    columnTypes: [],
    previewRows: [],
    rowActions: [],
    children: [],
    requirements: [],
    designs: [],
  };
}

/** New component with honest initial values (undefined source). */
export function newComponent(kind: MockupComponentKind, id: string): MockupComponent {
  const component = blankComponent(kind, id);
  switch (kind) {
    case "text":
      return { ...component, text: "Text" };
    case "field":
      return { ...component, label: "Field", fieldType: "text", origin: "undefined" };
    case "selector":
      return { ...component, label: "Selector", origin: "undefined" };
    case "button":
      return { ...component, label: "Button" };
    case "table":
      return { ...component, label: "Table", columns: ["column"], origin: "undefined" };
    case "container":
      return { ...component, label: "Group" };
    case "icon":
      return { ...component, label: "Icon", icon: "info" };
  }
}

export function addScreen(spec: MockupSpec, id: string, title: string): MockupSpec {
  return {
    ...spec,
    screens: [
      ...spec.screens,
      { id, title, requirements: [], designs: [], states: [], components: [] },
    ],
  };
}

export function renameScreen(
  spec: MockupSpec,
  screenId: string,
  patch: { id?: string; title?: string },
): MockupSpec {
  return {
    ...spec,
    screens: spec.screens.map((s) =>
      s.id === screenId
        ? {
            ...s,
            id: patch.id ?? s.id,
            title: patch.title ?? s.title,
          }
        : s,
    ),
  };
}

export function removeScreen(spec: MockupSpec, screenId: string): MockupSpec {
  return { ...spec, screens: spec.screens.filter((s) => s.id !== screenId) };
}

/**
 * Deletes a screen and clears the targets pointing at it (saving would
 * otherwise reject them as missing). Returns the affected components for
 * the confirmation message.
 */
export function removeScreenClean(
  spec: MockupSpec,
  screenId: string,
): { spec: MockupSpec; cleared: string[] } {
  const cleared: string[] = [];
  const screens = spec.screens
    .filter((s) => s.id !== screenId)
    .map((s) => ({
      ...s,
      components: s.components.map((c) => {
        if (c.target !== screenId) return c;
        cleared.push(`${s.id}/${c.id}`);
        const { target: _removed, ...rest } = c;
        return rest;
      }),
    }));
  return { spec: { ...spec, screens }, cleared };
}

/** Renames a component, validating uniqueness in the mockup. */
export function renameComponentId(
  spec: MockupSpec,
  screenId: string,
  oldId: string,
  newId: string,
): { ok: true; spec: MockupSpec } | { ok: false; reason: string } {
  const trimmed = newId.trim();
  if (!validMockupId(trimmed)) return { ok: false, reason: "Invalid identifier." };
  if (trimmed !== oldId && componentIds(spec).has(trimmed)) {
    return { ok: false, reason: "That identifier already exists in the mockup." };
  }
  return { ok: true, spec: updateComponent(spec, screenId, oldId, { id: trimmed }) };
}

/**
 * Renames a screen validating uniqueness and following the targets that
 * pointed at it (renaming does not break internal navigation).
 */
export function renameScreenId(
  spec: MockupSpec,
  oldId: string,
  newId: string,
): { ok: true; spec: MockupSpec } | { ok: false; reason: string } {
  const trimmed = newId.trim();
  if (!validMockupId(trimmed)) return { ok: false, reason: "Invalid identifier." };
  if (trimmed !== oldId && screenIds(spec).has(trimmed)) {
    return { ok: false, reason: "That screen already exists." };
  }
  const renamed = renameScreen(spec, oldId, { id: trimmed });
  return {
    ok: true,
    spec: {
      ...renamed,
      screens: renamed.screens.map((s) => ({
        ...s,
        components: s.components.map((c) =>
          c.target === oldId ? { ...c, target: trimmed } : c,
        ),
      })),
    },
  };
}

export function addComponent(
  spec: MockupSpec,
  screenId: string,
  component: MockupComponent,
): MockupSpec {
  return {
    ...spec,
    screens: spec.screens.map((s) =>
      s.id === screenId ? { ...s, components: [...s.components, component] } : s,
    ),
  };
}

export function updateComponent(
  spec: MockupSpec,
  screenId: string,
  componentId: string,
  patch: Partial<MockupComponent>,
): MockupSpec {
  return {
    ...spec,
    screens: spec.screens.map((s) =>
      s.id === screenId
        ? {
            ...s,
            components: s.components.map((c) =>
              c.id === componentId ? { ...c, ...patch, id: patch.id ?? c.id } : c,
            ),
          }
        : s,
    ),
  };
}

export function removeComponent(
  spec: MockupSpec,
  screenId: string,
  componentId: string,
): MockupSpec {
  return {
    ...spec,
    screens: spec.screens.map((s) =>
      s.id === screenId
        ? {
            ...s,
            components: s.components
              .filter((c) => c.id !== componentId)
              .map((c) =>
                c.children.includes(componentId)
                  ? { ...c, children: c.children.filter((child) => child !== componentId) }
                  : c,
              ),
          }
        : s,
    ),
  };
}

/** The component's parent container on the screen, if any. */
export function parentOf(
  spec: MockupSpec,
  screenId: string,
  componentId: string,
): MockupComponent | null {
  const screen = spec.screens.find((s) => s.id === screenId);
  if (!screen) return null;
  return (
    screen.components.find((c) => c.kind === "container" && c.children.includes(componentId)) ??
    null
  );
}

/**
 * Duplicates a component with fresh identifiers. Containers duplicate
 * with their children (new IDs and new grouping); the rest is a plain
 * copy. Returns the root clone and each clone origin to place them next
 * to their original.
 */
export function duplicateComponent(
  spec: MockupSpec,
  screenId: string,
  componentId: string,
): { spec: MockupSpec; cloneId: string; clones: { id: string; from: string }[] } | null {
  const screen = spec.screens.find((s) => s.id === screenId);
  const source = screen?.components.find((c) => c.id === componentId);
  if (!screen || !source) return null;
  const used = componentIds(spec);
  const fresh = (base: string): string => {
    const id = suggestMockupId(`${base}_copy`, used);
    used.add(id);
    return id;
  };
  const cloneId = fresh(source.id);
  const clones: MockupComponent[] = [{ ...source, id: cloneId, children: [] }];
  const origins: { id: string; from: string }[] = [{ id: cloneId, from: source.id }];
  if (source.kind === "container") {
    const remap = new Map<string, string>();
    for (const childId of source.children) {
      const child = screen.components.find((c) => c.id === childId);
      if (!child || child.kind === "container") continue;
      if (remap.has(childId)) continue;
      remap.set(childId, fresh(childId));
    }
    for (const [oldId, newId] of remap) {
      const child = screen.components.find((c) => c.id === oldId);
      if (child) {
        clones.push({ ...child, id: newId });
        origins.push({ id: newId, from: oldId });
      }
    }
    // Unclonable children (missing or containers) are released: sharing
    // a child with the original would break the single parent.
    const kept: string[] = [];
    for (const id of source.children) {
      const mapped = remap.get(id);
      if (mapped !== undefined) kept.push(mapped);
    }
    clones[0] = { ...clones[0], children: kept };
  }
  return {
    spec: {
      ...spec,
      screens: spec.screens.map((s) =>
        s.id === screenId ? { ...s, components: [...s.components, ...clones] } : s,
      ),
    },
    cloneId,
    clones: origins,
  };
}

export function setScreenRefs(
  spec: MockupSpec,
  screenId: string,
  patch: { requirements?: string[]; designs?: string[] },
): MockupSpec {
  return {
    ...spec,
    screens: spec.screens.map((s) =>
      s.id === screenId
        ? {
            ...s,
            requirements: patch.requirements ?? s.requirements,
            designs: patch.designs ?? s.designs,
          }
        : s,
    ),
  };
}

function nonEmpty(text: string | undefined, max: number): boolean {
  if (text === undefined) return false;
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= max;
}

function checkRefs(
  refs: string[],
  designs: string[],
  allowed: string[],
  tag: string,
  errors: string[],
): void {
  if (refs.length > MAX_MOCKUP_REFS) errors.push(`${tag}: too many references.`);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!allowed.includes(ref)) errors.push(`${tag}: ${ref} is not among the sources.`);
    if (seen.has(ref)) errors.push(`${tag}: duplicate reference (${ref}).`);
    seen.add(ref);
  }
  if (designs.length > MAX_MOCKUP_REFS) errors.push(`${tag}: too many design references.`);
  const seenDesigns = new Set<string>();
  for (const ref of designs) {
    const parts = ref.split("/");
    if (parts.length !== 2 || parts[0] === "" || !validMockupId(parts[1])) {
      errors.push(`${tag}: reference without artifact/element shape (${ref}).`);
      continue;
    }
    if (!allowed.includes(parts[0])) errors.push(`${tag}: ${ref} is not among the sources.`);
    if (seenDesigns.has(ref)) errors.push(`${tag}: duplicate reference (${ref}).`);
    seenDesigns.add(ref);
  }
}

/**
 * Immediate orientative validation: mirrors the Rust rules to guide the
 * person. The authoritative one runs on save; these messages never
 * replace the server error.
 */
export function validateMockupOrientative(spec: MockupSpec, allowed: string[]): string[] {
  const errors: string[] = [];
  if (!nonEmpty(spec.title, MAX_MOCKUP_TITLE)) errors.push("The mockup needs a title.");
  if (spec.screens.length > MAX_MOCKUP_SCREENS) errors.push("Too many screens.");
  const seenScreens = new Set<string>();
  const seenComponents = new Set<string>();
  const ids = screenIds(spec);
  spec.screens.forEach((screen, i) => {
    const n = i + 1;
    if (!validMockupId(screen.id)) errors.push(`Screen ${n}: invalid identifier.`);
    else if (seenScreens.has(screen.id)) errors.push(`Screen ${n}: duplicate identifier.`);
    seenScreens.add(screen.id);
    if (!nonEmpty(screen.title, MAX_MOCKUP_TITLE)) errors.push(`Screen ${n}: empty title.`);
    checkRefs(screen.requirements, screen.designs, allowed, `Screen ${n}`, errors);
    checkStates(screen, n, errors);
    if (screen.components.length > MAX_MOCKUP_COMPONENTS) {
      errors.push(`Screen ${n}: too many components.`);
    }
    const byId = new Map(screen.components.map((c) => [c.id, c]));
    const parented = new Set<string>();
    screen.components.forEach((c, j) => {
      const tag = `Screen ${n}, ${j + 1}`;
      if (!validMockupId(c.id)) errors.push(`${tag}: invalid identifier.`);
      else if (seenComponents.has(c.id)) errors.push(`${tag}: duplicate identifier in the mockup.`);
      seenComponents.add(c.id);
      checkRefs(c.requirements, c.designs, allowed, tag, errors);
      switch (c.kind) {
        case "text":
          if (!nonEmpty(c.text, MAX_MOCKUP_TEXT)) errors.push(`${tag}: empty text.`);
          break;
        case "field":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: missing label.`);
          if (c.name !== undefined && !validMockupId(c.name)) {
            errors.push(`${tag}: invalid logical name.`);
          }
          if (c.fieldType === undefined) errors.push(`${tag}: invalid field type.`);
          if (c.validations.length > MAX_MOCKUP_VALIDATIONS) {
            errors.push(`${tag}: too many validations.`);
          }
          if (c.validations.some((v) => !nonEmpty(v, MAX_MOCKUP_VALIDATION))) {
            errors.push(`${tag}: empty or excessive validation.`);
          }
          checkDataRef(c.dataRef, allowed, tag, errors);
          if (c.origin === undefined) errors.push(`${tag}: missing data origin.`);
          break;
        case "selector":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: missing label.`);
          if (c.options.length > MAX_MOCKUP_OPTIONS) errors.push(`${tag}: too many options.`);
          if (c.options.some((o) => !nonEmpty(o, MAX_MOCKUP_LABEL))) {
            errors.push(`${tag}: empty option.`);
          }
          if (c.origin === undefined) errors.push(`${tag}: missing data origin.`);
          break;
        case "button":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: missing label.`);
          checkTarget(c, ids, tag, errors);
          break;
        case "table":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: missing label.`);
          if (c.columns.length === 0) errors.push(`${tag}: the table needs columns.`);
          if (c.columns.length > MAX_MOCKUP_COLUMNS) errors.push(`${tag}: too many columns.`);
          if (c.columnTypes.length > 0 && c.columnTypes.length !== c.columns.length) {
            errors.push(`${tag}: one type per column.`);
          }
          if (c.previewRows.length > MAX_MOCKUP_PREVIEW_ROWS) {
            errors.push(`${tag}: too many sample rows.`);
          }
          if (c.previewRows.some((row) => row.length > c.columns.length)) {
            errors.push(`${tag}: row with more cells than columns.`);
          }
          if (c.rowActions.length > MAX_MOCKUP_ROW_ACTIONS) {
            errors.push(`${tag}: too many row actions.`);
          }
          if (c.origin === undefined) errors.push(`${tag}: missing data origin.`);
          break;
        case "container":
          if (c.label !== undefined && !nonEmpty(c.label, MAX_MOCKUP_LABEL)) {
            errors.push(`${tag}: empty label.`);
          }
          if (c.children.length > MAX_MOCKUP_CHILDREN) errors.push(`${tag}: too many children.`);
          checkChildren(c, byId, parented, tag, errors);
          break;
        case "icon":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: missing label.`);
          if (c.icon === undefined || !isMockupIcon(c.icon)) {
            errors.push(`${tag}: icon outside the catalog.`);
          }
          checkTarget(c, ids, tag, errors);
          break;
      }
    });
  });
  return errors;
}

function checkStates(
  screen: MockupSpec["screens"][number],
  n: number,
  errors: string[],
): void {
  if (screen.states.length > MAX_MOCKUP_STATES) {
    errors.push(`Screen ${n}: too many states.`);
  }
  const seen = new Set<string>();
  screen.states.forEach((state, i) => {
    const tag = `Screen ${n}, state ${i + 1}`;
    if (!validMockupId(state.id)) errors.push(`${tag}: invalid identifier.`);
    else if (seen.has(state.id)) errors.push(`${tag}: duplicate identifier.`);
    seen.add(state.id);
    if (!nonEmpty(state.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: empty label.`);
  });
}

function checkDataRef(
  dataRef: string | undefined,
  allowed: string[],
  tag: string,
  errors: string[],
): void {
  if (dataRef === undefined) return;
  const slash = dataRef.indexOf("/");
  if (slash <= 0) {
    errors.push(`${tag}: data reference without artifact/element shape.`);
    return;
  }
  const artifact = dataRef.slice(0, slash);
  const rest = dataRef.slice(slash + 1);
  if (!allowed.includes(artifact)) {
    errors.push(`${tag}: ${dataRef} is not among the sources.`);
    return;
  }
  const parts = rest.split(".");
  if (
    parts.length > 2 ||
    !validMockupId(parts[0]) ||
    (parts.length === 2 && !validMockupId(parts[1]))
  ) {
    errors.push(`${tag}: invalid data reference (${dataRef}).`);
  }
}

function checkTarget(
  c: { actionKind?: MockupActionKind; target?: string },
  ids: Set<string>,
  tag: string,
  errors: string[],
): void {
  if (c.target === undefined || c.target === "") return;
  if (!validMockupId(c.target)) {
    errors.push(`${tag}: invalid target.`);
    return;
  }
  const navigates = c.actionKind === undefined || c.actionKind === "navigate";
  if (navigates && !ids.has(c.target)) {
    errors.push(`${tag}: missing target (${c.target}).`);
  }
}

function checkChildren(
  c: MockupComponent,
  byId: Map<string, MockupComponent>,
  parented: Set<string>,
  tag: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const child of c.children) {
    if (child === c.id) {
      errors.push(`${tag}: cannot contain itself.`);
      continue;
    }
    const known = byId.get(child);
    if (!known) {
      errors.push(`${tag}: missing child (${child}).`);
      continue;
    }
    if (known.kind === "container") {
      errors.push(`${tag}: no nested containers.`);
      continue;
    }
    if (seen.has(child)) errors.push(`${tag}: repeated child (${child}).`);
    seen.add(child);
    if (parented.has(child)) errors.push(`${tag}: ${child} already has a container.`);
    parented.add(child);
  }
}

// ---------------------------------------------------------------------------
// Deterministic auto layout (only without a saved layout).
// ---------------------------------------------------------------------------

const CASCADE_DX = 220;
const CASCADE_DY = 110;
const CASCADE_COLS = 3;

/** Cascade in spec order for the given screen. */
export function autoMockupLayout(spec: MockupSpec, screenId: string): Layout {
  const layout: Layout = {};
  const screen = spec.screens.find((s) => s.id === screenId);
  if (!screen) return layout;
  screen.components.forEach((c, i) => {
    layout[c.id] = { x: (i % CASCADE_COLS) * CASCADE_DX, y: Math.floor(i / CASCADE_COLS) * CASCADE_DY };
  });
  return layout;
}

export type MockupAlign = "left" | "top" | "distributeH" | "distributeV";

export interface MockupBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Moves to align boxes. Layout only: semantics untouched. `left`/`top`
 * match the smallest edge; `distributeH/V` spread the space between the
 * first and the last (sorted). Empty without enough boxes (2 to align,
 * 3 to distribute).
 */
export function alignMoves(boxes: MockupBox[], mode: MockupAlign): { id: string; x: number; y: number }[] {
  if (boxes.length < 2) return [];
  if (mode === "left") {
    const x = Math.min(...boxes.map((b) => b.x));
    return boxes.filter((b) => b.x !== x).map((b) => ({ id: b.id, x, y: b.y }));
  }
  if (mode === "top") {
    const y = Math.min(...boxes.map((b) => b.y));
    return boxes.filter((b) => b.y !== y).map((b) => ({ id: b.id, x: b.x, y }));
  }
  if (boxes.length < 3) return [];
  const horizontal = mode === "distributeH";
  const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = (horizontal ? last.x - first.x : last.y - first.y) || 0;
  const step = span / (sorted.length - 1);
  const moves: { id: string; x: number; y: number }[] = [];
  sorted.forEach((box, i) => {
    if (i === 0 || i === sorted.length - 1) return;
    const at = Math.round((horizontal ? first.x : first.y) + step * i);
    if (horizontal && at !== box.x) moves.push({ id: box.id, x: at, y: box.y });
    if (!horizontal && at !== box.y) moves.push({ id: box.id, x: box.x, y: at });
  });
  return moves;
}

/** Default size per component (presentation only). */
export function defaultComponentSize(kind: MockupComponent["kind"]): { w: number; h: number } {
  switch (kind) {
    case "text":
      return { w: 180, h: 40 };
    case "field":
    case "selector":
      return { w: 200, h: 64 };
    case "button":
      return { w: 140, h: 44 };
    case "table":
      return { w: 280, h: 120 };
    case "container":
      return { w: 320, h: 200 };
    case "icon":
      return { w: 72, h: 72 };
  }
}

/** Summary for the UI: screens and components. */
export function mockupSummary(spec: MockupSpec): { screens: number; components: number } {
  return {
    screens: spec.screens.length,
    components: spec.screens.reduce((n, s) => n + s.components.length, 0),
  };
}
