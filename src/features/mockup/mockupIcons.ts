// Own mockup icon catalog. Pure: no React. Original geometric drawings
// of this project (see MockupIcon in MockupNodes): 32 minimal glyphs on
// a 24 grid, round stroke. No third-party assets or arbitrary SVG: the id
// is saved. Mirrors `MOCKUP_ICONS` in
// `src-tauri/crates/meta/src/mockup.rs`: Rust rejects an off-catalog icon
// on save.
export interface MockupIconMeta {
  id: string;
  /** Readable name for the catalog and the inspector. */
  label: string;
  /** Lowercase search words. */
  keywords: string[];
}

export const MOCKUP_ICON_CATALOG: MockupIconMeta[] = [
  { id: "home", label: "Home", keywords: ["home", "house", "main"] },
  { id: "search", label: "Search", keywords: ["search", "find", "filter"] },
  { id: "plus", label: "Add", keywords: ["add", "new", "plus", "more"] },
  { id: "edit", label: "Edit", keywords: ["edit", "pencil", "modify"] },
  { id: "trash", label: "Trash", keywords: ["trash", "delete", "remove", "bin"] },
  { id: "check", label: "Confirm", keywords: ["confirm", "accept", "check", "ok"] },
  { id: "x", label: "Close", keywords: ["close", "cancel", "x"] },
  { id: "chevron_up", label: "Up", keywords: ["up", "expand"] },
  { id: "chevron_down", label: "Down", keywords: ["down", "expand"] },
  { id: "chevron_left", label: "Previous", keywords: ["previous", "left", "back"] },
  { id: "chevron_right", label: "Next", keywords: ["next", "right", "forward"] },
  { id: "arrow_left", label: "Left arrow", keywords: ["arrow", "left", "back"] },
  { id: "arrow_right", label: "Right arrow", keywords: ["arrow", "right", "go"] },
  { id: "user", label: "User", keywords: ["user", "person", "account", "profile"] },
  { id: "settings", label: "Settings", keywords: ["settings", "configuration", "gear"] },
  { id: "menu", label: "Menu", keywords: ["menu", "options"] },
  { id: "bell", label: "Notifications", keywords: ["notifications", "bell", "alerts"] },
  { id: "info", label: "Information", keywords: ["information", "help", "detail"] },
  { id: "warning", label: "Warning", keywords: ["warning", "caution"] },
  { id: "error", label: "Error", keywords: ["error", "failure", "problem"] },
  { id: "save", label: "Save", keywords: ["save", "disk"] },
  { id: "folder", label: "Folder", keywords: ["folder", "directory", "files"] },
  { id: "file", label: "File", keywords: ["file", "document"] },
  { id: "calendar", label: "Calendar", keywords: ["calendar", "date", "day"] },
  { id: "clock", label: "Time", keywords: ["time", "clock"] },
  { id: "filter", label: "Filter", keywords: ["filter", "funnel"] },
  { id: "refresh", label: "Reload", keywords: ["reload", "refresh", "retry"] },
  { id: "download", label: "Download", keywords: ["download", "export"] },
  { id: "upload", label: "Upload", keywords: ["upload", "import"] },
  { id: "eye", label: "View", keywords: ["view", "eye", "show"] },
  { id: "lock", label: "Lock", keywords: ["lock", "secure", "private"] },
];

const MOCKUP_ICON_IDS = new Set(MOCKUP_ICON_CATALOG.map((icon) => icon.id));

/** Is it in the catalog? Mirrors Rust `valid_mockup_icon`. */
export function isMockupIcon(id: string): boolean {
  return MOCKUP_ICON_IDS.has(id);
}

/** Free-text catalog search (label or keywords). */
export function searchMockupIcons(query: string): MockupIconMeta[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...MOCKUP_ICON_CATALOG];
  return MOCKUP_ICON_CATALOG.filter(
    (icon) =>
      icon.id.includes(needle) ||
      icon.label.toLowerCase().includes(needle) ||
      icon.keywords.some((word) => word.includes(needle)),
  );
}
