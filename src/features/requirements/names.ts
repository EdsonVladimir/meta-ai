// Names and titles: mirror validation of Rust (`Name`, authority) plus
// presentation labels. Identity is the ID, never the name: duplicates
// are allowed and disambiguated with the ID.
// No React, no Tauri: tested with vitest without DOM.

/** Documented maximum, in characters. Mirror of `Name::MAX_CHARS`. */
export const MAX_NAME_CHARS = 120;

/**
 * Validates a name before sending it. Returns the human message, or null
 * when it passes. Rust revalidates on save (authority).
 */
export function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "The name cannot be empty.";
  const chars = [...trimmed].length;
  if (chars > MAX_NAME_CHARS) {
    return `The name has ${chars} characters; the maximum is ${MAX_NAME_CHARS}.`;
  }
  return null;
}

/**
 * An artifact label: own title, derived first line, or ID. Deriving
 * never touches the domain: presentation only, no AI.
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

/** Does the row need to show the ID as secondary? */
export function needsIdSecondary(label: string, id: string): boolean {
  return label !== id;
}

/**
 * A rename target. `current` is the name shown in the form; `expected`
 * is the expected revision that Rust revalidates (null = the artifact
 * has no own title yet). `derived` is the derived label (first line)
 * when there is no title, hint only. Identity (IDs) never changes on
 * rename.
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
  if (kind === "project") return "project";
  if (kind === "module") return "module";
  if (kind === "design") return "design";
  return "requirement";
}

export function renameTargetId(target: RenameTarget): string {
  if (target.kind === "project") return target.projectId;
  if (target.kind === "module") return target.moduleId;
  return target.artifactId;
}
