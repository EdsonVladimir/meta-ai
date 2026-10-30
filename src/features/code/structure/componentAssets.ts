// Reads what components point to: `templateUrl` is scanned, style files
// are only checked for existence. A file that cannot be read is
// reported, never guessed, and never fails the analysis.
import { scanTemplate } from "./ngTemplate";
import type { ComponentFacts, StructureResult, StructureSymbol } from "./structureTypes";

/** Larger templates are generated output, not something to scan. */
const MAX_TEMPLATE_CHARS = 400_000;

export async function attachComponentAssets(
  result: StructureResult,
  readFile: (rootId: string, rel: string) => Promise<{ text: string }>,
): Promise<StructureResult> {
  const reads = new Map<string, Promise<string | null>>();
  const read = (rootId: string, rel: string): Promise<string | null> => {
    const key = `${rootId}\n${rel}`;
    const known = reads.get(key);
    if (known !== undefined) return known;
    const pending = readFile(rootId, rel).then(
      (file) => file.text,
      () => null,
    );
    reads.set(key, pending);
    return pending;
  };
  const attach = async (
    symbol: StructureSymbol,
    component: ComponentFacts,
  ): Promise<StructureSymbol> => {
    const next: ComponentFacts = { ...component };
    const missing: string[] = [];
    if (component.templateRel !== null) {
      const html = await read(symbol.rootId, component.templateRel);
      if (html === null) missing.push(component.templateRel);
      next.template =
        html === null || html.length > MAX_TEMPLATE_CHARS
          ? null
          : scanTemplate(component.templateRel, html);
    }
    for (const rel of component.styleRels) {
      if ((await read(symbol.rootId, rel)) === null) missing.push(rel);
    }
    if (missing.length > 0) next.missingAssets = missing;
    return { ...symbol, component: next };
  };

  if (!result.symbols.some((symbol) => hasAssets(symbol.component))) return result;
  const symbols: StructureSymbol[] = [];
  for (const symbol of result.symbols) {
    const { component } = symbol;
    symbols.push(hasAssets(component) ? await attach(symbol, component) : symbol);
  }
  return { ...result, symbols };
}

function hasAssets(component: ComponentFacts | undefined): component is ComponentFacts {
  return component !== undefined && (component.templateRel !== null || component.styleRels.length > 0);
}
