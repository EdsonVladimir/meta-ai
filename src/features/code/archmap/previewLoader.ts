// Gathers what a preview draws: the component's template and styles and
// those of its children, from pending proposals first and disk otherwise.
// A file that cannot be read becomes a note, never a failed preview,
// except the component's own template.
import type { CodeProposalFileDto } from "../types";
import { scanTemplate } from "../structure/ngTemplate";
import type { ComponentFacts, StructureSymbol } from "../structure/structureTypes";
import { selectsElement } from "./flowModel";
import { buildPreview, type PreviewChild, type PreviewField } from "./templatePreview";

/** Bounds a large tree: the preview is a sketch, not a build. */
const MAX_COMPONENTS = 12;

export interface PreviewResult {
  document: string;
  fields: PreviewField[];
  notes: string[];
}

interface Source {
  name: string;
  rootId: string;
  rel: string;
  component?: ComponentFacts;
}

export async function loadPreview(input: {
  symbol: Source;
  symbols: StructureSymbol[];
  readFile: (rootId: string, rel: string) => Promise<{ text: string }>;
  proposalFiles: readonly CodeProposalFileDto[] | null;
}): Promise<PreviewResult> {
  const { symbols, readFile, proposalFiles } = input;
  const notes = new Set<string>();
  const children = new Map<string, PreviewChild>();
  let loaded = 0;

  const textOf = async (rootId: string, rel: string): Promise<string | null> => {
    const proposed = proposalFiles?.find(
      (file) => file.rootId === rootId && file.rel === rel && file.state === "pending",
    );
    if (proposed !== undefined) return proposed.content;
    try {
      return (await readFile(rootId, rel)).text;
    } catch {
      return null;
    }
  };

  const templateOf = async (source: Source): Promise<string | null> => {
    const { component } = source;
    if (component?.templateRel != null) return textOf(source.rootId, component.templateRel);
    return component?.templateText ?? null;
  };

  const stylesOf = async (source: Source): Promise<string> => {
    const parts: string[] = [];
    for (const rel of source.component?.styleRels ?? []) {
      if (!rel.toLowerCase().endsWith(".css")) {
        notes.add("SCSS and other style languages are not compiled here.");
        continue;
      }
      const css = await textOf(source.rootId, rel);
      if (css === null) notes.add(`Could not read ${rel}.`);
      else parts.push(css);
    }
    return parts.join("\n");
  };

  const collect = async (rel: string, html: string, parent: Source): Promise<void> => {
    for (const use of scanTemplate(rel, html).uses) {
      if (use.kind !== "element" || children.has(use.name)) continue;
      const matches = symbols.filter(
        (symbol) => symbol.rootId === parent.rootId && selectsElement(symbol, use.name),
      );
      const imports = parent.component?.imports ?? [];
      const imported = matches.filter((symbol) => imports.includes(symbol.name));
      const found = matches.length === 1 ? matches : imported;
      if (found.length !== 1) continue;
      if (loaded >= MAX_COMPONENTS) {
        notes.add(`Only the first ${MAX_COMPONENTS} child components are drawn.`);
        return;
      }
      loaded += 1;
      const childHtml = await templateOf(found[0]);
      if (childHtml === null) continue;
      children.set(use.name, { html: childHtml, css: await stylesOf(found[0]) });
      await collect(found[0].rel, childHtml, found[0]);
    }
  };

  const html = await templateOf(input.symbol);
  if (html === null) throw new Error(`Could not read the template of ${input.symbol.name}.`);
  const css = await stylesOf(input.symbol);
  await collect(input.symbol.rel, html, input.symbol);
  const { document, fields } = buildPreview({
    html,
    css,
    child: (tag) => children.get(tag) ?? null,
  });
  return { document, fields, notes: [...notes] };
}
