// Modelo semántico del editor de mockups. Puro: sin React, sin Tauri.
// El JSON estructurado sigue siendo autoritativo; este módulo lo parsea,
// lo transforma con operaciones totales y lo serializa en forma canónica.
// Las posiciones y tamaños NO viven aquí (ver Layout): mover o
// redimensionar jamás toca la semántica.
//
// Refleja el subconjunto de `src-tauri/crates/meta/src/mockup.rs`:
// pantallas con identidad, componentes texto|campo|selector|botón|tabla,
// origen del dato obligatorio en campo/selector/tabla, destinos de
// navegación existentes y referencias dentro del conjunto declarado.
// La validación aquí es orientativa; la autoritativa vive en Rust.
import type { Layout } from "../design/editing/specModel";
import type {
  MockupComponent,
  MockupComponentKind,
  MockupFieldType,
  MockupOrigin,
  MockupSpec,
} from "./types";

export type {
  MockupComponent,
  MockupComponentKind,
  MockupFieldType,
  MockupOrigin,
  MockupScreen,
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

export const COMPONENT_KINDS: MockupComponentKind[] = [
  "text",
  "field",
  "selector",
  "button",
  "table",
];
export const FIELD_TYPES: MockupFieldType[] = ["text", "number", "date", "boolean"];
export const ORIGINS: MockupOrigin[] = [
  "persisted",
  "calculated",
  "temporary",
  "external",
  "undefined",
];

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

function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parsea un mockup guardado (contenido canónico). Null ante forma ajena. */
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
      if (options === null || columns === null) return null;
      components.push({
        id: item.id,
        kind,
        text: optString(item.text),
        label: optString(item.label),
        fieldType: asFieldType(item.field_type) ?? undefined,
        required: item.required === true,
        validation: optString(item.validation),
        options,
        columns,
        action: optString(item.action),
        target: optString(item.target),
        origin: asOrigin(item.origin) ?? undefined,
        requirements: creq,
        designs: cdes,
      });
    }
    screens.push({ id: raw.id, title: raw.title, requirements, designs, components });
  }
  return { title: value.title, screens };
}

/**
 * Serialización canónica: mismo orden de claves y omisiones que
 * `canonical_mockup_json` en Rust, para que la comparación de borrador
 * (sucio/limpio) coincida con lo guardado. No valida: serializa.
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
      components: screen.components.map((c) => {
        const out: Record<string, unknown> = { id: c.id, kind: c.kind };
        if (c.text !== undefined) out.text = c.text;
        if (c.label !== undefined) out.label = c.label;
        if (c.fieldType !== undefined) out.field_type = c.fieldType;
        if (c.required) out.required = true;
        if (c.validation !== undefined) out.validation = c.validation;
        if (c.options.length > 0) out.options = c.options;
        if (c.columns.length > 0) out.columns = c.columns;
        if (c.action !== undefined) out.action = c.action;
        if (c.target !== undefined) out.target = c.target;
        if (c.origin !== undefined) out.origin = c.origin;
        if (c.requirements.length > 0) out.requirements = c.requirements;
        if (c.designs.length > 0) out.designs = c.designs;
        return out;
      }),
    })),
  });
}

/** ¿Identificador válido? Letras, dígitos y subrayado, 1–64. */
export function validMockupId(id: string): boolean {
  const trimmed = id.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 64 &&
    /^[A-Za-z0-9_]+$/.test(trimmed)
  );
}

/** Sugiere un identificador libre con un prefijo (`campo`, `campo_2`…). */
export function suggestMockupId(prefix: string, used: Set<string>): string {
  const base = prefix.trim() === "" ? "e" : prefix;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Todos los identificadores de componente del mockup. */
export function componentIds(spec: MockupSpec): Set<string> {
  const ids = new Set<string>();
  for (const screen of spec.screens) {
    for (const component of screen.components) ids.add(component.id);
  }
  return ids;
}

/** Todos los identificadores de pantalla del mockup. */
export function screenIds(spec: MockupSpec): Set<string> {
  return new Set(spec.screens.map((s) => s.id));
}

/**
 * Detecta un renombrado único de componente entre dos especificaciones
 * (para trasladar su disposición). Null si no hay exactamente uno.
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
    options: [],
    columns: [],
    requirements: [],
    designs: [],
  };
}

/** Componente nuevo con valores iniciales honestos (origen sin definir). */
export function newComponent(kind: MockupComponentKind, id: string): MockupComponent {
  const component = blankComponent(kind, id);
  switch (kind) {
    case "text":
      return { ...component, text: "Texto" };
    case "field":
      return { ...component, label: "Campo", fieldType: "text", origin: "undefined" };
    case "selector":
      return { ...component, label: "Selector", origin: "undefined" };
    case "button":
      return { ...component, label: "Botón" };
    case "table":
      return { ...component, label: "Tabla", columns: ["columna"], origin: "undefined" };
  }
}

export function addScreen(spec: MockupSpec, id: string, title: string): MockupSpec {
  return {
    ...spec,
    screens: [
      ...spec.screens,
      { id, title, requirements: [], designs: [], components: [] },
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
 * Borra una pantalla y limpia los destinos que apuntaban a ella (si no,
 * el guardado los rechazaría por inexistentes). Devuelve los componentes
 * afectados para el mensaje de confirmación.
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

/** Renombra un componente validando unicidad en el mockup. */
export function renameComponentId(
  spec: MockupSpec,
  screenId: string,
  oldId: string,
  newId: string,
): { ok: true; spec: MockupSpec } | { ok: false; reason: string } {
  const trimmed = newId.trim();
  if (!validMockupId(trimmed)) return { ok: false, reason: "Identificador inválido." };
  if (trimmed !== oldId && componentIds(spec).has(trimmed)) {
    return { ok: false, reason: "Ese identificador ya existe en el mockup." };
  }
  return { ok: true, spec: updateComponent(spec, screenId, oldId, { id: trimmed }) };
}

/**
 * Renombra una pantalla validando unicidad y siguiendo los destinos que
 * apuntaban a ella (el renombrado no rompe la navegación interna).
 */
export function renameScreenId(
  spec: MockupSpec,
  oldId: string,
  newId: string,
): { ok: true; spec: MockupSpec } | { ok: false; reason: string } {
  const trimmed = newId.trim();
  if (!validMockupId(trimmed)) return { ok: false, reason: "Identificador inválido." };
  if (trimmed !== oldId && screenIds(spec).has(trimmed)) {
    return { ok: false, reason: "Esa pantalla ya existe." };
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
        ? { ...s, components: s.components.filter((c) => c.id !== componentId) }
        : s,
    ),
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
  if (refs.length > MAX_MOCKUP_REFS) errors.push(`${tag}: demasiadas referencias.`);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!allowed.includes(ref)) errors.push(`${tag}: ${ref} no está entre las fuentes.`);
    if (seen.has(ref)) errors.push(`${tag}: referencia duplicada (${ref}).`);
    seen.add(ref);
  }
  if (designs.length > MAX_MOCKUP_REFS) errors.push(`${tag}: demasiadas referencias a diseños.`);
  const seenDesigns = new Set<string>();
  for (const ref of designs) {
    const parts = ref.split("/");
    if (parts.length !== 2 || parts[0] === "" || !validMockupId(parts[1])) {
      errors.push(`${tag}: referencia sin forma artefacto/elemento (${ref}).`);
      continue;
    }
    if (!allowed.includes(parts[0])) errors.push(`${tag}: ${ref} no está entre las fuentes.`);
    if (seenDesigns.has(ref)) errors.push(`${tag}: referencia duplicada (${ref}).`);
    seenDesigns.add(ref);
  }
}

/**
 * Validación orientativa inmediata: espeja las reglas de Rust para guiar
 * a la persona. La autoritativa ocurre al guardar; estos mensajes nunca
 * sustituyen al error del servidor.
 */
export function validateMockupOrientative(spec: MockupSpec, allowed: string[]): string[] {
  const errors: string[] = [];
  if (!nonEmpty(spec.title, MAX_MOCKUP_TITLE)) errors.push("El mockup necesita un título.");
  if (spec.screens.length > MAX_MOCKUP_SCREENS) errors.push("Demasiadas pantallas.");
  const seenScreens = new Set<string>();
  const seenComponents = new Set<string>();
  const ids = screenIds(spec);
  spec.screens.forEach((screen, i) => {
    const n = i + 1;
    if (!validMockupId(screen.id)) errors.push(`Pantalla ${n}: identificador inválido.`);
    else if (seenScreens.has(screen.id)) errors.push(`Pantalla ${n}: identificador duplicado.`);
    seenScreens.add(screen.id);
    if (!nonEmpty(screen.title, MAX_MOCKUP_TITLE)) errors.push(`Pantalla ${n}: título vacío.`);
    checkRefs(screen.requirements, screen.designs, allowed, `Pantalla ${n}`, errors);
    if (screen.components.length > MAX_MOCKUP_COMPONENTS) {
      errors.push(`Pantalla ${n}: demasiados componentes.`);
    }
    screen.components.forEach((c, j) => {
      const tag = `Pantalla ${n}, ${j + 1}`;
      if (!validMockupId(c.id)) errors.push(`${tag}: identificador inválido.`);
      else if (seenComponents.has(c.id)) errors.push(`${tag}: identificador duplicado en el mockup.`);
      seenComponents.add(c.id);
      checkRefs(c.requirements, c.designs, allowed, tag, errors);
      switch (c.kind) {
        case "text":
          if (!nonEmpty(c.text, MAX_MOCKUP_TEXT)) errors.push(`${tag}: texto vacío.`);
          break;
        case "field":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: falta la etiqueta.`);
          if (c.fieldType === undefined) errors.push(`${tag}: tipo de campo inválido.`);
          if (c.validation !== undefined && !nonEmpty(c.validation, MAX_MOCKUP_VALIDATION)) {
            errors.push(`${tag}: validación vacía.`);
          }
          if (c.origin === undefined) errors.push(`${tag}: falta el origen del dato.`);
          break;
        case "selector":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: falta la etiqueta.`);
          if (c.options.length > MAX_MOCKUP_OPTIONS) errors.push(`${tag}: demasiadas opciones.`);
          if (c.options.some((o) => !nonEmpty(o, MAX_MOCKUP_LABEL))) {
            errors.push(`${tag}: opción vacía.`);
          }
          if (c.origin === undefined) errors.push(`${tag}: falta el origen del dato.`);
          break;
        case "button":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: falta la etiqueta.`);
          if (
            c.target !== undefined &&
            c.target !== "" &&
            (!validMockupId(c.target) || !ids.has(c.target))
          ) {
            errors.push(`${tag}: destino inexistente (${c.target}).`);
          }
          break;
        case "table":
          if (!nonEmpty(c.label, MAX_MOCKUP_LABEL)) errors.push(`${tag}: falta la etiqueta.`);
          if (c.columns.length === 0) errors.push(`${tag}: la tabla necesita columnas.`);
          if (c.columns.length > MAX_MOCKUP_COLUMNS) errors.push(`${tag}: demasiadas columnas.`);
          if (c.origin === undefined) errors.push(`${tag}: falta el origen del dato.`);
          break;
      }
    });
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Trazado automático determinista (solo sin disposición guardada).
// ---------------------------------------------------------------------------

const CASCADE_DX = 220;
const CASCADE_DY = 110;
const CASCADE_COLS = 3;

/** Cascada por orden de la especificación para la pantalla indicada. */
export function autoMockupLayout(spec: MockupSpec, screenId: string): Layout {
  const layout: Layout = {};
  const screen = spec.screens.find((s) => s.id === screenId);
  if (!screen) return layout;
  screen.components.forEach((c, i) => {
    layout[c.id] = { x: (i % CASCADE_COLS) * CASCADE_DX, y: Math.floor(i / CASCADE_COLS) * CASCADE_DY };
  });
  return layout;
}

/** Tamaño por defecto según el componente (solo presentación). */
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
  }
}

/** Resumen para la interfaz: pantallas y componentes. */
export function mockupSummary(spec: MockupSpec): { screens: number; components: number } {
  return {
    screens: spec.screens.length,
    components: spec.screens.reduce((n, s) => n + s.components.length, 0),
  };
}
