// Layer taxonomy for the architecture map: assigns every analyzed file to
// exactly one layer, deterministically and without guessing.
//
// The rules below are the documented convention (Angular / NestJS / generic
// TypeScript). Anything that matches no rule lands in "unassigned" with its
// reason instead of being forced into a layer. Decorators refine the verdict
// when present (a `@Controller()` class is a controller even in an oddly
// named file); the refinement is reported, never silent.
//
// Layer order follows the call direction: entries on top, data contracts and
// wiring below. Empty layers are hidden per analysis.
export type ArchLayer =
  | "ui"
  | "controllers"
  | "state"
  | "services"
  | "contracts"
  | "composition"
  | "crosscutting"
  | "unassigned";

export interface ArchLayerDef {
  id: ArchLayer;
  /** 1-based display order (call direction, top to bottom). */
  order: number;
  label: string;
  description: string;
  /** Two-letter column badge (decorative; the label stays the name). */
  badge: string;
}

export const ARCH_LAYERS: ArchLayerDef[] = [
  {
    id: "ui",
    order: 1,
    label: "UI Components",
    description: "Screens and visual components (Angular components, pages, views).",
    badge: "UI",
  },
  {
    id: "controllers",
    order: 2,
    label: "Controllers",
    description: "HTTP entries (NestJS controllers, route handlers).",
    badge: "CT",
  },
  {
    id: "state",
    order: 3,
    label: "State",
    description: "Client stores, signals and reducers.",
    badge: "ST",
  },
  {
    id: "services",
    order: 4,
    label: "Services",
    description: "Business logic providers (NestJS injectables, app services).",
    badge: "SV",
  },
  {
    id: "contracts",
    order: 5,
    label: "Data Contracts",
    description: "DTOs, entities, interfaces, models and shared types.",
    badge: "DC",
  },
  {
    id: "composition",
    order: 6,
    label: "Composition",
    description: "Wiring: modules, routes, barrels and entry points.",
    badge: "CO",
  },
  {
    id: "crosscutting",
    order: 7,
    label: "Cross-cutting",
    description: "Guards, interceptors, middlewares, config and utilities.",
    badge: "CC",
  },
  {
    id: "unassigned",
    order: 8,
    label: "Unassigned",
    description: "Matched no rule. Listed honestly instead of being misplaced.",
    badge: "–",
  },
];

export const ARCH_LAYER_BY_ID: Record<ArchLayer, ArchLayerDef> = Object.fromEntries(
  ARCH_LAYERS.map((def) => [def.id, def]),
) as Record<ArchLayer, ArchLayerDef>;

export interface ClassifiedFile {
  layer: ArchLayer;
  /** Human-readable rule that decided (shown in the inspector). */
  reason: string;
}

interface SuffixRule {
  suffix: string;
  layer: ArchLayer;
}

const SUFFIX_RULES: SuffixRule[] = [
  { suffix: ".component.", layer: "ui" },
  { suffix: ".page.", layer: "ui" },
  { suffix: ".view.", layer: "ui" },
  { suffix: ".controller.", layer: "controllers" },
  { suffix: ".store.", layer: "state" },
  { suffix: ".state.", layer: "state" },
  { suffix: ".signals.", layer: "state" },
  { suffix: ".reducer.", layer: "state" },
  { suffix: ".effects.", layer: "state" },
  { suffix: ".service.", layer: "services" },
  { suffix: ".provider.", layer: "services" },
  { suffix: ".dto.", layer: "contracts" },
  { suffix: ".enum.", layer: "contracts" },
  { suffix: ".enums.", layer: "contracts" },
  { suffix: ".const.", layer: "contracts" },
  { suffix: ".constants.", layer: "contracts" },
  { suffix: ".entity.", layer: "contracts" },
  { suffix: ".entities.", layer: "contracts" },
  { suffix: ".interface.", layer: "contracts" },
  { suffix: ".model.", layer: "contracts" },
  { suffix: ".models.", layer: "contracts" },
  { suffix: ".types.", layer: "contracts" },
  { suffix: ".type.", layer: "contracts" },
  { suffix: ".schema.", layer: "contracts" },
  { suffix: ".module.", layer: "composition" },
  { suffix: ".routes.", layer: "composition" },
  { suffix: ".routing.", layer: "composition" },
  { suffix: ".guard.", layer: "crosscutting" },
  { suffix: ".interceptor.", layer: "crosscutting" },
  { suffix: ".middleware.", layer: "crosscutting" },
  { suffix: ".pipe.", layer: "crosscutting" },
  { suffix: ".filter.", layer: "crosscutting" },
  { suffix: ".decorator.", layer: "crosscutting" },
  { suffix: ".util.", layer: "crosscutting" },
  { suffix: ".utils.", layer: "crosscutting" },
  { suffix: ".helper.", layer: "crosscutting" },
  { suffix: ".helpers.", layer: "crosscutting" },
];

const DIR_RULES: Array<{ dir: string; layer: ArchLayer }> = [
  { dir: "components/", layer: "ui" },
  { dir: "pages/", layer: "ui" },
  { dir: "views/", layer: "ui" },
  { dir: "controllers/", layer: "controllers" },
  { dir: "store/", layer: "state" },
  { dir: "stores/", layer: "state" },
  { dir: "state/", layer: "state" },
  { dir: "services/", layer: "services" },
  { dir: "providers/", layer: "services" },
  { dir: "dto/", layer: "contracts" },
  { dir: "dtos/", layer: "contracts" },
  { dir: "entities/", layer: "contracts" },
  { dir: "entity/", layer: "contracts" },
  { dir: "interfaces/", layer: "contracts" },
  { dir: "models/", layer: "contracts" },
  { dir: "types/", layer: "contracts" },
  { dir: "schemas/", layer: "contracts" },
  { dir: "guards/", layer: "crosscutting" },
  { dir: "interceptors/", layer: "crosscutting" },
  { dir: "middlewares/", layer: "crosscutting" },
  { dir: "middleware/", layer: "crosscutting" },
  { dir: "common/", layer: "crosscutting" },
  { dir: "config/", layer: "crosscutting" },
  { dir: "environments/", layer: "crosscutting" },
  { dir: "utils/", layer: "crosscutting" },
  { dir: "util/", layer: "crosscutting" },
  { dir: "helpers/", layer: "crosscutting" },
  { dir: "shared/", layer: "crosscutting" },
];

/** Entry points and wiring files, matched by exact basename. */
const ENTRY_NAMES: Record<string, ArchLayer> = {
  "main.ts": "composition",
  "server.ts": "composition",
  "app.ts": "composition",
  "index.ts": "composition",
  "enums.ts": "contracts",
  "constants.ts": "contracts",
};

const DECORATOR_LAYER: Record<string, ArchLayer> = {
  Component: "ui",
  Directive: "ui",
  Controller: "controllers",
  Injectable: "services",
  Module: "composition",
  Entity: "contracts",
};

/**
 * Classifies a file by path only. Pure and total: every input gets exactly
 * one layer plus the rule that decided it.
 */
export function classifyFile(rel: string): ClassifiedFile {
  const lower = rel.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (base.includes(".spec.") || base.includes(".test.")) {
    return { layer: "unassigned", reason: "test file (not layered)" };
  }
  for (const rule of SUFFIX_RULES) {
    if (base.includes(rule.suffix)) {
      return { layer: rule.layer, reason: `suffix ${rule.suffix} in file name` };
    }
  }
  for (const rule of DIR_RULES) {
    if (lower.includes(rule.dir)) {
      return { layer: rule.layer, reason: `directory ${rule.dir}` };
    }
  }
  const entry = ENTRY_NAMES[base];
  if (entry !== undefined) {
    return { layer: entry, reason: `entry/wiring file ${base}` };
  }
  return { layer: "unassigned", reason: "no rule matched" };
}

/**
 * Refines a path verdict with the decorators found on the file's classes.
 * The first decorator with a known layer wins; when it differs from the
 * path verdict, the decorator wins and the reason says so.
 */
export function refineByDecorators(base: ClassifiedFile, decorators: string[]): ClassifiedFile {
  for (const name of decorators) {
    const layer = DECORATOR_LAYER[name];
    if (layer === undefined) continue;
    if (layer === base.layer) {
      return { layer, reason: `${base.reason}; decorator @${name} agrees` };
    }
    return { layer, reason: `decorator @${name} overrides ${base.reason}` };
  }
  return base;
}

/** Name suffixes carrying architectural responsibility (documented heuristic). */
const SYMBOL_NAME_RULES: Array<{ suffix: RegExp; label: string; layer: ArchLayer }> = [
  { suffix: /controller$/i, label: "Controller", layer: "controllers" },
  { suffix: /(service|provider)$/i, label: "Service", layer: "services" },
  { suffix: /(component|page|view)$/i, label: "Component", layer: "ui" },
  { suffix: /(store|state|reducer|effects|signals)$/i, label: "Store", layer: "state" },
  { suffix: /(dto|entity|model|schema)$/i, label: "Dto", layer: "contracts" },
  { suffix: /(module|routes|routing)$/i, label: "Module", layer: "composition" },
  {
    suffix: /(guard|interceptor|middleware|pipe|filter)$/i,
    label: "Guard",
    layer: "crosscutting",
  },
];

export interface SymbolIdentity {
  kind: string;
  name: string;
  decorators: string[];
}

/**
 * Classifies one symbol, never its whole file: a DTO interface stays a
 * contract even beside an `@Injectable` class. Order: the symbol's own
 * decorator, its kind (interfaces/enums are contracts, components are
 * UI), its name suffix, then the file path as context. Pure and total.
 */
export function classifySymbol(rel: string, symbol: SymbolIdentity): ClassifiedFile {
  for (const name of symbol.decorators) {
    const layer = DECORATOR_LAYER[name];
    if (layer === undefined) continue;
    return { layer, reason: `decorator @${name} on this ${symbol.kind}` };
  }
  if (symbol.kind === "interface" || symbol.kind === "enum") {
    return { layer: "contracts", reason: `${symbol.kind} by kind (contract)` };
  }
  if (symbol.kind === "component") {
    return { layer: "ui", reason: "component by kind (UI)" };
  }
  for (const rule of SYMBOL_NAME_RULES) {
    if (rule.suffix.test(symbol.name)) {
      return { layer: rule.layer, reason: `name suffix "${rule.label}"` };
    }
  }
  const pathVerdict = classifyFile(rel);
  if (pathVerdict.layer !== "unassigned") {
    return { layer: pathVerdict.layer, reason: `file path: ${pathVerdict.reason}` };
  }
  return { layer: "unassigned", reason: "no rule matched" };
}
