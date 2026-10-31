// Approximate preview of an Angular template: its structure and own
// styles, with no logic and no data. Pure. Interpolations become labeled
// placeholders, control blocks show their content once, child components
// expand, and unknown tags become labeled boxes. Attributes are an
// allowlist: this HTML may come from a model. The document also carries
// a CSP, and the viewer's iframe sandbox runs no scripts.

export interface PreviewChild {
  html: string;
  css: string;
}

export interface PreviewField {
  name: string;
  type: string;
  /** Written as `[disabled]="…"`: it depends on state. */
  conditionallyDisabled: boolean;
  required: boolean;
}

const MAX_DEPTH = 3;
const REMOVED_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "base",
  "meta",
  "title",
  "noscript",
]);
const TRANSPARENT_ELEMENTS = new Set(["ng-container", "ng-template"]);
const SAFE_ATTRIBUTES = new Set([
  "class",
  "id",
  "type",
  "placeholder",
  "value",
  "for",
  "name",
  "disabled",
  "required",
  "readonly",
  "rows",
  "cols",
  "min",
  "max",
  "minlength",
  "maxlength",
  "checked",
  "selected",
  "multiple",
  "colspan",
  "rowspan",
  "alt",
  "title",
  "role",
]);
const FIELD_TAGS = new Set(["input", "textarea", "select"]);
const BLOCK = /^@(else if|if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/;
const NAME_START = /[A-Za-z]/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A readable name for an expression: `store.count()` reads `count`. */
function labelOf(expression: string): string {
  const main = expression.split("|")[0].trim();
  const names = main.match(/[A-Za-z_$][\w$]*/g) ?? [];
  const last = names[names.length - 1];
  return last === undefined ? "value" : last;
}

interface Attribute {
  name: string;
  value: string;
}

interface Context {
  child: (tag: string) => PreviewChild | null;
  fields: PreviewField[];
  css: string[];
  depth: number;
}

function fieldOf(tag: string, attributes: Attribute[]): PreviewField {
  const read = (name: string): string | undefined =>
    attributes.find((entry) => entry.name === name)?.value;
  const bound = read("[(ngModel)]") ?? read("[ngModel]") ?? read("[formControl]");
  const name =
    read("formControlName") ??
    (bound === undefined ? undefined : labelOf(bound)) ??
    read("name") ??
    read("id") ??
    tag;
  return {
    name,
    type: tag === "input" ? (read("type") ?? "text") : tag,
    conditionallyDisabled: read("[disabled]") !== undefined || read("[readonly]") !== undefined,
    required: read("required") !== undefined || read("[required]") !== undefined,
  };
}

function renderAttributes(tag: string, attributes: Attribute[], field: PreviewField | null): string {
  const safe = attributes.filter((entry) => SAFE_ATTRIBUTES.has(entry.name.toLowerCase()));
  const parts = safe.map((entry) => ` ${entry.name}="${escapeHtml(entry.value)}"`);
  const hasPlaceholder = safe.some((entry) => entry.name === "placeholder");
  if (field !== null && tag !== "select" && !hasPlaceholder) {
    parts.push(` placeholder="${escapeHtml(field.name)}"`);
  }
  return parts.join("");
}

function readAttributes(html: string, from: number): { attributes: Attribute[]; end: number; selfClosed: boolean } | null {
  const attributes: Attribute[] = [];
  let i = from;
  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i])) i += 1;
    if (i >= html.length) return null;
    if (html[i] === ">") return { attributes, end: i + 1, selfClosed: false };
    if (html.startsWith("/>", i)) return { attributes, end: i + 2, selfClosed: true };
    if (html[i] === "/") {
      i += 1;
      continue;
    }
    const start = i;
    while (i < html.length && !/[\s=>]/.test(html[i]) && !html.startsWith("/>", i)) i += 1;
    const name = html.slice(start, i);
    while (i < html.length && /\s/.test(html[i])) i += 1;
    let value = "";
    if (html[i] === "=") {
      i += 1;
      while (i < html.length && /\s/.test(html[i])) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close === -1) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const start2 = i;
        while (i < html.length && !/[\s>]/.test(html[i])) i += 1;
        value = html.slice(start2, i);
      }
    }
    attributes.push({ name, value });
  }
  return null;
}

function transform(html: string, ctx: Context): string {
  let out = "";
  let blocks = 0;
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      i = close === -1 ? html.length : close + 3;
    } else if (html.startsWith("{{", i)) {
      const close = html.indexOf("}}", i + 2);
      if (close === -1) break;
      out += `<span class="ruth-value">${escapeHtml(labelOf(html.slice(i + 2, close)))}</span>`;
      i = close + 2;
    } else if (html.startsWith("</", i)) {
      const close = html.indexOf(">", i);
      if (close === -1) break;
      const tag = html.slice(i + 2, close).trim().toLowerCase();
      if (/^[a-z][\w:-]*$/.test(tag) && !TRANSPARENT_ELEMENTS.has(tag)) {
        out += tag.includes("-") ? "</div>" : `</${tag}>`;
      }
      i = close + 1;
    } else if (html[i] === "<" && NAME_START.test(html[i + 1] ?? "")) {
      let end = i + 1;
      while (end < html.length && /[\w:-]/.test(html[end])) end += 1;
      const tag = html.slice(i + 1, end).toLowerCase();
      const parsed = readAttributes(html, end);
      if (parsed === null) break;
      i = parsed.end;
      if (REMOVED_ELEMENTS.has(tag)) {
        if (!parsed.selfClosed) {
          const close = html.toLowerCase().indexOf(`</${tag}`, i);
          const after = close === -1 ? -1 : html.indexOf(">", close);
          i = after === -1 ? html.length : after + 1;
        }
      } else if (TRANSPARENT_ELEMENTS.has(tag)) {
        continue;
      } else if (tag.includes("-") && tag !== "ng-content") {
        const child = ctx.depth < MAX_DEPTH ? ctx.child(tag) : null;
        if (child === null) {
          out += `<div class="ruth-box"><span class="ruth-tag">${escapeHtml(tag)}</span>`;
        } else {
          ctx.css.push(child.css);
          out += `<div class="ruth-child">${transform(child.html, { ...ctx, depth: ctx.depth + 1 })}`;
        }
        if (parsed.selfClosed) out += "</div>";
      } else if (tag === "ng-content") {
        out += '<div class="ruth-box"><span class="ruth-tag">projected content</span></div>';
      } else {
        const field = FIELD_TAGS.has(tag) ? fieldOf(tag, parsed.attributes) : null;
        if (field !== null) ctx.fields.push(field);
        out += `<${tag}${renderAttributes(tag, parsed.attributes, field)}${parsed.selfClosed ? " /" : ""}>`;
      }
    } else if (html[i] === "@") {
      const block = BLOCK.exec(html.slice(i, i + 12));
      if (block !== null) {
        let end = i + block[0].length;
        let parens = 0;
        while (end < html.length && !(html[end] === "{" && parens === 0)) {
          if (html[end] === "(") parens += 1;
          if (html[end] === ")") parens -= 1;
          end += 1;
        }
        blocks += 1;
        i = end + 1;
      } else if (html.startsWith("@let ", i)) {
        const close = html.indexOf(";", i);
        i = close === -1 ? html.length : close + 1;
      } else {
        out += "@";
        i += 1;
      }
    } else if (html[i] === "}" && blocks > 0) {
      blocks -= 1;
      i += 1;
    } else {
      out += html[i] === "<" ? "&lt;" : html[i];
      i += 1;
    }
  }
  return out;
}

const BASE_CSS = `
body { margin: 16px; background: #fff; color: #1b2430;
  font: 14px/1.45 system-ui, sans-serif; }
input, select, textarea, button { font: inherit; padding: 4px 6px; margin: 2px; }
table { border-collapse: collapse; }
th, td { border: 1px solid #ccd3db; padding: 4px 8px; }
.ruth-value { padding: 0 5px; border-radius: 3px; background: #e7ecf2; color: #48566a;
  font-size: 0.85em; }
.ruth-box { margin: 6px 0; padding: 8px; border: 1px dashed #93a1b3; border-radius: 4px; }
.ruth-tag { display: block; color: #5d6b7f; font-size: 0.8em; }
`;

function safeCss(css: string): string {
  return css
    .replace(/<\/?style/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/:host\b/g, ".ruth-child");
}

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

export function buildPreview(input: {
  html: string;
  css: string;
  child: (tag: string) => PreviewChild | null;
}): { document: string; fields: PreviewField[] } {
  const ctx: Context = { child: input.child, fields: [], css: [input.css], depth: 0 };
  const body = transform(input.html, ctx);
  const css = ctx.css.map(safeCss).join("\n");
  return {
    fields: ctx.fields,
    document:
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
      `<style>${BASE_CSS}</style><style>${css}</style></head>` +
      `<body><div class="ruth-child">${body}</div></body></html>`,
  };
}

export function fieldSummary(field: PreviewField): string {
  const notes = [
    ...(field.required ? ["required"] : []),
    ...(field.conditionallyDisabled ? ["disabled by a condition"] : []),
  ];
  return `${field.name} (${field.type}${notes.length > 0 ? `, ${notes.join(", ")}` : ""})`;
}
