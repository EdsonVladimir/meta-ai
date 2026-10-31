// The files behind a card, as viewer tabs: its source, its template and
// its styles. Pure. What a component names but was not found stays
// listed as missing; a pending proposal shows its own content, because
// that file may not be on disk yet.
import type { CodeProposalFileDto } from "../types";
import type { ComponentFacts } from "../structure/structureTypes";
import { languageBadge } from "./memberRoles";

export interface SourceSymbol {
  name: string;
  rootId: string;
  rel: string;
  component?: ComponentFacts;
  range?: { startLine: number } | null;
}

export interface SourceTab {
  key: string;
  label: string;
  rootId: string;
  rel: string;
  /** 1-based line to reveal, when one matters. */
  line: number | null;
  missing: boolean;
  /** Pending content from a proposal; read from disk when absent. */
  proposed: string | null;
}

function extensionLabel(rel: string): string {
  const dot = rel.lastIndexOf(".");
  return dot === -1 ? "CSS" : rel.slice(dot + 1).toUpperCase();
}

export function sourceTabsOf(
  symbol: SourceSymbol,
  proposalFiles: readonly CodeProposalFileDto[] | null = null,
): SourceTab[] {
  const { component, rootId } = symbol;
  const missing = new Set(component?.missingAssets ?? []);
  const proposed = (rel: string): string | null =>
    proposalFiles?.find(
      (file) => file.rootId === rootId && file.rel === rel && file.state === "pending",
    )?.content ?? null;
  const tab = (key: string, label: string, rel: string, line: number | null): SourceTab => {
    const content = proposed(rel);
    return { key, label, rootId, rel, line, proposed: content, missing: content === null && missing.has(rel) };
  };
  const tabs = [
    tab("code", languageBadge(symbol.rel), symbol.rel, symbol.range?.startLine ?? null),
  ];
  if (component?.templateRel != null) {
    tabs.push(tab("template", "HTML", component.templateRel, null));
  } else if (component?.templateLine !== undefined) {
    // An inline template lives in the source file itself.
    tabs.push(tab("template", "HTML", symbol.rel, component.templateLine));
  }
  const styles = component?.styleRels ?? [];
  const labels = styles.map(extensionLabel);
  styles.forEach((rel, index) => {
    const repeated = labels.indexOf(labels[index]) !== labels.lastIndexOf(labels[index]);
    tabs.push(
      tab(`style:${rel}`, repeated ? `${labels[index]} ${index + 1}` : labels[index], rel, null),
    );
  });
  return tabs;
}
