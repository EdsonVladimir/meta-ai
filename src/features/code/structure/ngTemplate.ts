// Tolerant Angular template scanner: custom elements, directive
// attributes, pipes and the calls its expressions make, with lines. It
// does not validate Angular syntax, and broken markup drops the broken
// tag only. Pure, no dependency: a single pass over the text.
import type { TemplateCall, TemplateFacts, TemplateUse } from "./structureTypes";

/** Bounds a hostile or generated template. */
const MAX_TEMPLATE_ENTRIES = 400;

const GLOBAL_ATTRIBUTES = new Set([
  "class",
  "id",
  "style",
  "title",
  "name",
  "type",
  "value",
  "href",
  "src",
  "alt",
  "for",
  "placeholder",
  "disabled",
  "required",
]);
const NAME_START = /[A-Za-z]/;
/** Raw text elements: their content is never markup. */
const RAW_ELEMENTS = new Set(["script", "style"]);
const CONTROL_BLOCK = /^@(?:if|else\s+if|for|switch|case)\s*\(/;
const PIPE = /(?<!\|)\|(?!\|)\s*([A-Za-z_$][\w$]*)/g;
// One to three segments ending in a call; longer paths are not provable.
const CALL = /(?<![\w$.])(?:this\.)?([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?(?:\.([A-Za-z_$][\w$]*))?\s*\(/g;
const KEYWORDS = new Set(["if", "for", "switch", "case", "track", "of", "let"]);

function withoutStrings(expression: string): string {
  return expression.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, (text) =>
    text.replace(/[^\n]/g, " "),
  );
}

export function scanTemplate(rel: string, html: string, firstLine = 1): TemplateFacts {
  const uses: TemplateUse[] = [];
  const calls: TemplateCall[] = [];
  const seenUses = new Set<string>();
  const seenCalls = new Set<string>();

  const lineAt = (position: number): number => {
    let line = firstLine;
    for (let i = 0; i < position; i += 1) {
      if (html.charCodeAt(i) === 10) line += 1;
    }
    return line;
  };
  const addUse = (kind: TemplateUse["kind"], name: string, line: number): void => {
    const key = `${kind}:${name}`;
    if (seenUses.has(key) || uses.length >= MAX_TEMPLATE_ENTRIES) return;
    seenUses.add(key);
    uses.push({ name, kind, line });
  };
  const addCall = (path: string[], event: boolean, line: number): void => {
    const key = `${event}:${path.join(".")}`;
    if (seenCalls.has(key) || calls.length >= MAX_TEMPLATE_ENTRIES) return;
    seenCalls.add(key);
    calls.push({ path, event, line });
  };
  const scanExpression = (expression: string, start: number, event: boolean): void => {
    const text = withoutStrings(expression);
    const lineOfMatch = (index: number): number => {
      const newlines = text.slice(0, index).split("\n").length - 1;
      return lineAt(start) + newlines;
    };
    for (const match of text.matchAll(PIPE)) addUse("pipe", match[1], lineOfMatch(match.index));
    for (const match of text.matchAll(CALL)) {
      const path = [match[1], match[2], match[3]].filter((part) => part !== undefined);
      if (path.length === 1 && KEYWORDS.has(path[0])) continue;
      addCall(path, event, lineOfMatch(match.index));
    }
  };

  /** Parses one tag from `<`. Returns where to resume. */
  const scanTag = (open: number): number => {
    let i = open + 1;
    while (i < html.length && /[\w:-]/.test(html[i])) i += 1;
    const tag = html.slice(open + 1, i);
    const line = lineAt(open);
    const attributes: Array<{ name: string; value: string; at: number; line: number }> = [];
    while (i < html.length) {
      while (i < html.length && /\s/.test(html[i])) i += 1;
      if (i >= html.length) return i;
      if (html[i] === "<") return i;
      if (html[i] === ">" || html.startsWith("/>", i)) {
        const end = html[i] === ">" ? i + 1 : i + 2;
        if (tag.includes("-")) addUse("element", tag, line);
        for (const attribute of attributes) scanAttribute(attribute);
        if (RAW_ELEMENTS.has(tag.toLowerCase()) && html[i] === ">") {
          const close = html.toLowerCase().indexOf(`</${tag.toLowerCase()}`, end);
          return close === -1 ? html.length : close;
        }
        return end;
      }
      if (html[i] === "/") {
        i += 1;
        continue;
      }
      const nameStart = i;
      while (i < html.length && !/[\s=>]/.test(html[i]) && html[i] !== "<") i += 1;
      const name = html.slice(nameStart, i);
      const attributeLine = lineAt(nameStart);
      while (i < html.length && /\s/.test(html[i])) i += 1;
      let value = "";
      let at = i;
      if (html[i] === "=") {
        i += 1;
        while (i < html.length && /\s/.test(html[i])) i += 1;
        const quote = html[i];
        if (quote === '"' || quote === "'") {
          const close = html.indexOf(quote, i + 1);
          if (close === -1) return html.length;
          at = i + 1;
          value = html.slice(at, close);
          i = close + 1;
        } else {
          at = i;
          while (i < html.length && !/[\s>]/.test(html[i])) i += 1;
          value = html.slice(at, i);
        }
      }
      attributes.push({ name, value, at, line: attributeLine });
    }
    return i;
  };

  const scanAttribute = (attribute: {
    name: string;
    value: string;
    at: number;
    line: number;
  }): void => {
    const { name, value, at, line } = attribute;
    const isEvent = name.startsWith("(") && name.endsWith(")");
    const isBound = name.startsWith("[") || name.startsWith("*");
    if (isEvent || isBound) scanExpression(value, at, isEvent);
    if (isEvent || name.startsWith("#") || name.startsWith("@")) return;
    const plain = name.replace(/[[\]()*]/g, "");
    if (plain === "" || plain.includes(".")) return;
    if (plain.startsWith("aria-") || plain.startsWith("data-") || plain.startsWith("let-")) return;
    if (!GLOBAL_ATTRIBUTES.has(plain)) addUse("attribute", plain, line);
  };

  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      i = close === -1 ? html.length : close + 3;
    } else if (html[i] === "<" && NAME_START.test(html[i + 1] ?? "")) {
      i = scanTag(i);
    } else if (html.startsWith("{{", i)) {
      const close = html.indexOf("}}", i + 2);
      if (close === -1) break;
      scanExpression(html.slice(i + 2, close), i + 2, false);
      i = close + 2;
    } else if (html[i] === "@") {
      const block = CONTROL_BLOCK.exec(html.slice(i, i + 40));
      if (block === null) {
        i += 1;
        continue;
      }
      let depth = 1;
      const start = i + block[0].length;
      let end = start;
      while (end < html.length && depth > 0) {
        if (html[end] === "(") depth += 1;
        if (html[end] === ")") depth -= 1;
        end += 1;
      }
      scanExpression(html.slice(start, end - 1), start, false);
      i = end;
    } else {
      i += 1;
    }
  }
  return { rel, uses, calls };
}
