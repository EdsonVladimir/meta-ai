// Nombres y títulos: validación espejo de Rust (`Name`, autoridad) y
// etiquetas de presentación. La identidad es el ID, nunca el nombre:
// los duplicados se permiten y se desambigua con el ID.
// Sin React ni Tauri: se prueba con vitest sin DOM.

/** Máximo documentado, en caracteres. Espejo de `Name::MAX_CHARS`. */
export const MAX_NAME_CHARS = 120;

/**
 * Valida un nombre antes de enviarlo. Devuelve el mensaje para personas o
 * null si pasa. Rust revalida al guardar (autoridad).
 */
export function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "El nombre no puede estar vacío.";
  const chars = [...trimmed].length;
  if (chars > MAX_NAME_CHARS) {
    return `El nombre tiene ${chars} caracteres; el máximo es ${MAX_NAME_CHARS}.`;
  }
  return null;
}

/**
 * Etiqueta de un artefacto: título propio, primera línea derivada o ID.
 * Derivar no toca el dominio: es solo presentación, sin IA.
 */
export function artifactLabel(
  title: string | null,
  derived: string | null,
  id: string,
): string {
  if (title !== null && title !== "") return title;
  if (derived !== null && derived !== "") return derived;
  return id;
}

/** ¿Necesita la fila mostrar el ID como secundario? */
export function needsIdSecondary(label: string, id: string): boolean {
  return label !== id;
}

/**
 * Objetivo de un renombrado. `current` es el nombre mostrado en el
 * formulario; `expected` es la revisión esperada que Rust revalida
 * (null = el artefacto aún no tiene título propio). `derived` es la
 * etiqueta derivada (primera línea) cuando no hay título, solo pista.
 * La identidad (IDs) nunca cambia al renombrar.
 */
export type RenameTarget =
  | { kind: "project"; projectId: string; current: string; expected: string }
  | { kind: "module"; projectId: string; moduleId: string; current: string; expected: string }
  | {
      kind: "requirement" | "design";
      projectId: string;
      moduleId: string;
      artifactId: string;
      current: string;
      expected: string | null;
      derived: string | null;
    };

export function renameKindLabel(kind: RenameTarget["kind"]): string {
  if (kind === "project") return "proyecto";
  if (kind === "module") return "módulo";
  if (kind === "design") return "diagrama";
  return "requisito";
}

export function renameTargetId(target: RenameTarget): string {
  if (target.kind === "project") return target.projectId;
  if (target.kind === "module") return target.moduleId;
  return target.artifactId;
}
