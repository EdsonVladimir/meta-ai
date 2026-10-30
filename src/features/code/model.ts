// Pure code-workspace model: tab keys, labels and disambiguation. No
// React or Tauri: tested in model.test.ts.
import type { CodeTab } from "./types";

/** Stable tab key: root + path. Never duplicated. */
export function tabKey(rootId: string, rel: string): string {
  return `${rootId}::${rel}`;
}

export function tabKeyOf(tab: Pick<CodeTab, "rootId" | "rel">): string {
  return tabKey(tab.rootId, tab.rel);
}

/** File names opened more than once: must be disambiguated. */
export function duplicatedNames(tabs: Pick<CodeTab, "name">[]): Set<string> {
  const counts = new Map<string, number>();
  for (const tab of tabs) counts.set(tab.name, (counts.get(tab.name) ?? 0) + 1);
  const out = new Set<string>();
  for (const [name, count] of counts) if (count > 1) out.add(name);
  return out;
}

/**
 * Secondary tab label: the root (and the parent folder when the root
 * matches too). Empty when the name is unique.
 */
export function tabQualifier(tab: Pick<CodeTab, "rootName" | "rel" | "name">, tabs: Pick<CodeTab, "name">[]): string {
  if (!duplicatedNames(tabs).has(tab.name)) return "";
  const parent = tab.rel.includes("/") ? tab.rel.slice(0, tab.rel.lastIndexOf("/")) : "";
  return parent === "" ? tab.rootName : `${tab.rootName} · ${parent}`;
}

/** Opens or focuses: when the tab exists, only the active one changes. */
export function openTab(
  tabs: CodeTab[],
  next: Pick<CodeTab, "rootId" | "rootName" | "rel" | "name">,
): { tabs: CodeTab[]; active: string } {
  const key = tabKey(next.rootId, next.rel);
  if (tabs.some((tab) => tabKeyOf(tab) === key)) return { tabs, active: key };
  return {
    tabs: [
      ...tabs,
      {
        ...next,
        content: null,
        error: null,
        loading: true,
        savedText: null,
        dirty: false,
        saving: false,
        saveError: null,
        language: languageForFile(next.rel),
      },
    ],
    active: key,
  };
}

/** Closes a tab and picks an active neighbor (or null when none remain). */
export function closeTab(tabs: CodeTab[], key: string, active: string | null): { tabs: CodeTab[]; active: string | null } {
  const index = tabs.findIndex((tab) => tabKeyOf(tab) === key);
  if (index < 0) return { tabs, active };
  const rest = tabs.filter((_, i) => i !== index);
  if (active !== key) return { tabs: rest, active };
  if (rest.length === 0) return { tabs: rest, active: null };
  const neighbor = rest[Math.min(index, rest.length - 1)];
  return { tabs: rest, active: tabKeyOf(neighbor) };
}

/** Tabs depending on a root (to clean up when removing it). */
export function tabsOfRoot(tabs: CodeTab[], rootId: string): string[] {
  return tabs.filter((tab) => tab.rootId === rootId).map(tabKeyOf);
}

/**
 * 32-bit FNV-1a fingerprint in hex over UTF-8 bytes: a change
 * detector, NOT a cryptographic hash. Identical to
 * `ruth-code::fnv1a_hex` so the frontend and Rust compare fingerprints
 * (shared vectors on both sides).
 */
export function fnv1aHex(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Extensions with structure analysis (TS now; Rust in stage B). */
export function analyzableLanguage(rel: string): "ts" | "rust" | null {
  const lower = rel.toLowerCase();
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  ) {
    return "ts";
  }
  if (lower.endsWith(".rs")) return "rust";
  return null;
}

/** Containing folder of a relative path ("" = workspace root). */
export function parentDir(rel: string): string {
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

export type FolderScopeOutcome = "added" | "full" | "none" | "dupes";

/** Outcome of adding a folder to the scope, to pick the notice. */
export function folderScopeOutcome(
  analyzable: number,
  added: number,
  scopeSize: number,
  maxFiles: number,
): FolderScopeOutcome {
  if (scopeSize >= maxFiles) return "full";
  if (analyzable === 0) return "none";
  if (added === 0) return "dupes";
  return "added";
}

/** Languages offered in the picker (Monaco highlighting, nothing semantic). */
export const CODE_LANGUAGES: Array<{ id: string; label: string }> = [
  { id: "plaintext", label: "Plain text" },
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "rust", label: "Rust" },
  { id: "python", label: "Python" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
  { id: "yaml", label: "YAML" },
  { id: "ini", label: "INI" },
  { id: "shell", label: "Shell" },
  { id: "dockerfile", label: "Dockerfile" },
];

/** Initial language per extension; unknown = plain text. */
export function languageForFile(rel: string): string {
  const name = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  const dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot + 1);
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
    case "jsonc":
      return "json";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "md":
    case "markdown":
      return "markdown";
    case "yaml":
    case "yml":
      return "yaml";
    case "ini":
      return "ini";
    case "toml":
      // Monaco 0.57 ships no TOML grammar: INI covers sections and keys.
      return "ini";
    case "sh":
    case "bash":
      return "shell";
    default:
      return "plaintext";
  }
}
