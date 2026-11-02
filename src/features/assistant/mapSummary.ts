// Session-only architecture-map summaries for the Muse project
// context. ProjectMapView publishes one summary per analyzed section
// when it reaches ready, plus the detected services; the Assistant
// renders one text per root. Cleared when the workspace closes.
// Nothing is persisted, guessed, or sent from here: rendering reads
// only the local analysis results and has no AI input.
import { ARCH_LAYER_BY_ID, type ArchLayer } from "../code/archmap/archLayers";
import type { ArchMap } from "../code/archmap/archModel";
import type { RouteRecordFact } from "../code/structure/structureTypes";

/** Mirror of MAX_CONTEXT_MAP_CHARS in ruth-meta: one text per root. */
export const MAP_SUMMARY_MAX_CHARS = 6_000;
/** Routes and classes named per service before "+N more" says so. */
const MAX_ROUTES_SHOWN = 20;
const MAX_CLASSES_SHOWN = 20;
/** Largest classes kept per section for the renderer. */
const MAX_CLASSES_STORED = 30;

export interface MapSummaryLayer {
  layer: ArchLayer;
  symbols: number;
}

export interface MapSummaryRoute {
  path: string;
  component: string | null;
}

export interface MapSummaryClass {
  name: string;
  members: number;
}

export interface MapSectionSummary {
  key: string;
  rootId: string;
  rootName: string;
  title: string;
  /** Analyzed folder relative to the root ("" is the whole root). */
  rel: string;
  kind: "project" | "folder" | "implicit";
  filesAnalyzed: number;
  /** Capped collection or analysis, or fewer files than collected. */
  partial: boolean;
  layers: MapSummaryLayer[];
  /** Null when the analysis never finished (routes unknown). */
  routes: MapSummaryRoute[] | null;
  classes: MapSummaryClass[];
}

export interface DetectedSummaryService {
  key: string;
  rootId: string;
  name: string;
}

/**
 * Extracts what the renderer needs from a ready section: layer
 * counts, route paths, and the largest classes. Pure: no store, no IO.
 */
export function summarizeSection(input: {
  key: string;
  rootId: string;
  rootName: string;
  title: string;
  rel: string;
  kind: MapSectionSummary["kind"];
  map: ArchMap;
  /** Null when the merged result is missing (routes unknown). */
  routes: RouteRecordFact[] | null;
  filesAnalyzed: number;
  partial: boolean;
}): MapSectionSummary {
  const perLayer = new Map<ArchLayer, number>();
  for (const node of input.map.nodes) {
    perLayer.set(node.layer, (perLayer.get(node.layer) ?? 0) + 1);
  }
  const layers = [...perLayer.entries()]
    .map(([layer, symbols]) => ({ layer, symbols }))
    .sort(
      (a, b) =>
        b.symbols - a.symbols || ARCH_LAYER_BY_ID[a.layer].order - ARCH_LAYER_BY_ID[b.layer].order,
    );
  const classes = input.map.nodes
    .filter((node) => node.symbol.kind === "class" || node.symbol.kind === "component")
    .map((node) => ({ name: node.symbol.name, members: node.symbol.members.length }))
    .sort((a, b) => b.members - a.members || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, MAX_CLASSES_STORED);
  return {
    key: input.key,
    rootId: input.rootId,
    rootName: input.rootName,
    title: input.title,
    rel: input.rel,
    kind: input.kind,
    filesAnalyzed: input.filesAnalyzed,
    partial: input.partial,
    layers,
    routes:
      input.routes === null
        ? null
        : input.routes.map((route) => ({
            path: route.path ?? "(computed path)",
            component: route.component,
          })),
    classes,
  };
}

function routeText(route: MapSummaryRoute): string {
  return route.component === null ? route.path : `${route.path} -> ${route.component}`;
}

/**
 * Renders the map text for one root, within MAP_SUMMARY_MAX_CHARS:
 * services, layers with counts (largest first), routes, and main
 * class names. Empty when no section was analyzed: without an analyzed
 * service the message carries docs only. Pure.
 */
export function renderRootSummary(
  root: { id: string; name: string },
  sections: MapSectionSummary[],
  unanalyzed: string[],
): string {
  const analyzed = [...sections].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (analyzed.length === 0) return "";
  const lines = [
    `Root: ${root.name} (${root.id})`,
    `Analyzed services (${analyzed.length}): ${analyzed.map((section) => section.title).join(", ")}`,
  ];
  if (unanalyzed.length > 0) {
    const names = [...unanalyzed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    lines.push(`Not analyzed (${unanalyzed.length}): ${names.join(", ")}`);
  }
  for (const section of analyzed) {
    const where = section.rel === "" ? "whole folder" : `folder ${section.rel}`;
    const files = `${section.filesAnalyzed} ${section.filesAnalyzed === 1 ? "file" : "files"} analyzed`;
    lines.push(`- ${section.title} (${where}, ${files}${section.partial ? ", partial" : ""})`);
    lines.push(
      section.layers.length === 0
        ? "  Layers: none"
        : `  Layers: ${section.layers
            .map(
              ({ layer, symbols }) =>
                `${ARCH_LAYER_BY_ID[layer].label} ${symbols} ${symbols === 1 ? "symbol" : "symbols"}`,
            )
            .join(", ")}`,
    );
    if (section.routes === null) {
      lines.push("  Routes: unknown (analysis incomplete)");
    } else if (section.routes.length === 0) {
      lines.push("  Routes: none found");
    } else {
      const shown = section.routes.slice(0, MAX_ROUTES_SHOWN).map(routeText).join(", ");
      const rest = section.routes.length - Math.min(section.routes.length, MAX_ROUTES_SHOWN);
      lines.push(`  Routes: ${shown}${rest > 0 ? ` (+${rest} more)` : ""}`);
    }
    if (section.classes.length === 0) {
      lines.push("  Main classes: none found");
    } else {
      const shown = section.classes
        .slice(0, MAX_CLASSES_SHOWN)
        .map((item) => `${item.name} (${item.members} ${item.members === 1 ? "member" : "members"})`)
        .join(", ");
      const rest = section.classes.length - Math.min(section.classes.length, MAX_CLASSES_SHOWN);
      lines.push(`  Main classes: ${shown}${rest > 0 ? ` (+${rest} more)` : ""}`);
    }
  }
  const text = lines.join("\n");
  if (text.length <= MAP_SUMMARY_MAX_CHARS) return text;
  const total = text.length;
  const note = `…(cut: showing ${MAP_SUMMARY_MAX_CHARS} of ${total} characters)`;
  return `${text.slice(0, MAP_SUMMARY_MAX_CHARS - note.length - 1)}\n${note}`;
}

const sectionsByKey = new Map<string, MapSectionSummary>();
const signaturesByFile = new Map<string, string>();

interface SignatureSymbol {
  name: string;
  rel: string;
  members: Array<{ name: string; detail: string }>;
}

/** Records the classes and methods of each analyzed file. */
export function publishFileSignatures(rootId: string, symbols: SignatureSymbol[]): void {
  const perFile = new Map<string, string[]>();
  for (const symbol of symbols) {
    const members = symbol.members.map((member) => `  ${member.name}${member.detail}`.slice(0, 120));
    const lines = perFile.get(symbol.rel) ?? [];
    lines.push(symbol.name, ...members);
    perFile.set(symbol.rel, lines);
  }
  for (const [rel, lines] of perFile) {
    signaturesByFile.set(`${rootId}::${rel}`, lines.join("\n"));
  }
}

/** Classes and methods of one file, or null when it was not analyzed. */
export function fileSignatures(rootId: string, rel: string): string | null {
  return signaturesByFile.get(`${rootId}::${rel}`) ?? null;
}
let detected: DetectedSummaryService[] = [];

/** Records (or replaces) the summary of one ready section. */
export function publishMapSection(summary: MapSectionSummary): void {
  sectionsByKey.set(summary.key, summary);
}

/** Replaces the detected services (one Architecture view owns them). */
export function publishDetectedServices(services: DetectedSummaryService[]): void {
  detected = [...services];
}

/** Analyzed sections of the given roots, in publish order. */
export function mapSectionsForRoots(rootIds: string[]): MapSectionSummary[] {
  const wanted = new Set(rootIds);
  return [...sectionsByKey.values()].filter((section) => wanted.has(section.rootId));
}

/** Detected services of the given roots. */
export function detectedForRoots(rootIds: string[]): DetectedSummaryService[] {
  const wanted = new Set(rootIds);
  return detected.filter((service) => wanted.has(service.rootId));
}

/** Drops every summary. Called when the workspace closes. */
export function clearMapSummaries(): void {
  sectionsByKey.clear();
  signaturesByFile.clear();
  detected = [];
}
