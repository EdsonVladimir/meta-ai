// File icon by extension: minimal own glyphs, no third-party assets.
// Presentation only; the text provides the accessible label.
// (Lives here for all of Ruth; `code/fileIcons.ts` re-exports it.)
export type CodeFileIconKind =
  | "code"
  | "markup"
  | "style"
  | "data"
  | "config"
  | "script"
  | "image"
  | "text";

export interface CodeFileIcon {
  kind: CodeFileIconKind;
  /** Short badge inside the glyph (may be empty). */
  badge: string;
  label: string;
}

const BY_EXTENSION: Record<string, CodeFileIcon> = {
  ts: { kind: "code", badge: "TS", label: "TypeScript" },
  tsx: { kind: "code", badge: "TS", label: "TypeScript" },
  mts: { kind: "code", badge: "TS", label: "TypeScript" },
  cts: { kind: "code", badge: "TS", label: "TypeScript" },
  js: { kind: "code", badge: "JS", label: "JavaScript" },
  jsx: { kind: "code", badge: "JS", label: "JavaScript" },
  mjs: { kind: "code", badge: "JS", label: "JavaScript" },
  cjs: { kind: "code", badge: "JS", label: "JavaScript" },
  rs: { kind: "code", badge: "RS", label: "Rust" },
  py: { kind: "code", badge: "PY", label: "Python" },
  html: { kind: "markup", badge: "‹›", label: "HTML" },
  htm: { kind: "markup", badge: "‹›", label: "HTML" },
  xml: { kind: "markup", badge: "‹›", label: "XML" },
  md: { kind: "markup", badge: "MD", label: "Markdown" },
  markdown: { kind: "markup", badge: "MD", label: "Markdown" },
  css: { kind: "style", badge: "#", label: "CSS" },
  scss: { kind: "style", badge: "#", label: "CSS" },
  json: { kind: "data", badge: "{}", label: "JSON" },
  jsonc: { kind: "data", badge: "{}", label: "JSON" },
  yaml: { kind: "data", badge: "Y", label: "YAML" },
  yml: { kind: "data", badge: "Y", label: "YAML" },
  toml: { kind: "config", badge: "≡", label: "TOML" },
  ini: { kind: "config", badge: "≡", label: "INI" },
  env: { kind: "config", badge: "≡", label: "Environment variables" },
  sh: { kind: "script", badge: ">_", label: "Shell" },
  bash: { kind: "script", badge: ">_", label: "Shell" },
  png: { kind: "image", badge: "IM", label: "Image" },
  jpg: { kind: "image", badge: "IM", label: "Image" },
  jpeg: { kind: "image", badge: "IM", label: "Image" },
  gif: { kind: "image", badge: "IM", label: "Image" },
  webp: { kind: "image", badge: "IM", label: "Image" },
  ico: { kind: "image", badge: "IM", label: "Image" },
  svg: { kind: "image", badge: "IM", label: "Image" },
};

/** Icon for a file name (accepts a relative path). */
export function fileIconForName(path: string): CodeFileIcon {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile") return { kind: "script", badge: "D", label: "Dockerfile" };
  if (name === "makefile") return { kind: "script", badge: "M", label: "Makefile" };
  if (name === "readme" || name === "readme.md") {
    return { kind: "markup", badge: "MD", label: "Markdown" };
  }
  const dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot + 1);
  return (
    BY_EXTENSION[ext] ?? { kind: "text", badge: "", label: "File" }
  );
}
