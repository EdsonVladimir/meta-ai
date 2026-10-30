// Shared board filtering for every map: layer toggles, test/config
// toggles, plus a search matching file paths, symbol names and member
// names. File and symbol projections filter separately; manual layer
// overrides apply to symbols only. Pure and tested.
import { isInExternalFolder, type ExternalFolder } from "./externalLibraries";
import { ARCH_LAYER_BY_ID, ARCH_LAYERS, type ArchLayer } from "./archLayers";
import type { ArchMap, ArchMapFile, ArchMapNode } from "./archModel";
import { fileKey, type BoardColumn, type SymbolColumn } from "./boardLayout";

export function matchMapFile(file: ArchMapFile, needle: string): boolean {
  if (needle === "") return true;
  const lower = needle.toLowerCase();
  return (
    file.rel.toLowerCase().includes(lower) ||
    file.symbols.some(
      (symbol) =>
        symbol.name.toLowerCase().includes(lower) ||
        symbol.members.some((member) => member.name.toLowerCase().includes(lower)),
    )
  );
}

/** Test file by the same convention the layer rules use (`.spec.`/`.test.`). */
export function isTestFile(rel: string): boolean {
  const base = rel.toLowerCase().split("/").pop() ?? "";
  return base.includes(".spec.") || base.includes(".test.");
}

/**
 * Configuration file: `*.config.ts` siblings or Angular-style
 * environment files. A documented name convention, not a guess about
 * what the file does.
 */
export function isConfigFile(rel: string): boolean {
  const lower = rel.toLowerCase();
  const base = lower.split("/").pop() ?? "";
  if (/(^|\.)config\.(ts|tsx|mts|cts)$/.test(base)) return true;
  return lower.startsWith("environments/") || lower.includes("/environments/");
}

export interface FilteredMap {
  columns: BoardColumn[];
  visibleKeys: Set<string>;
  /** Files left out by the test/config toggles (never silent). */
  hiddenTests: number;
  hiddenConfigs: number;
}

export interface MapFilterOpts {
  showTests?: boolean;
  showConfig?: boolean;
  /**
   * Module filter: only these symbol ids stay. Files follow
   * their symbols (a file shows when it keeps at least one
   * symbol, listing only those). Null disables the filter.
   */
  onlyIds?: Set<string> | null;
  /** Marked as libraries: listed as references, never as cards. */
  externalFolders?: readonly ExternalFolder[];
}

export function filterMapColumns(
  map: ArchMap | null,
  query: string,
  layersOn: Record<ArchLayer, boolean>,
  opts: MapFilterOpts = {},
): FilteredMap {
  const empty: FilteredMap = {
    columns: [],
    visibleKeys: new Set(),
    hiddenTests: 0,
    hiddenConfigs: 0,
  };
  if (map === null) return empty;
  const needle = query.trim();
  const showTests = opts.showTests ?? true;
  const showConfig = opts.showConfig ?? true;
  const onlyIds = opts.onlyIds ?? null;
  let hiddenTests = 0;
  let hiddenConfigs = 0;
  const columns = ARCH_LAYERS.map((def) => ({
    layer: def.id,
    files: map.files.flatMap((file) => {
      if (isInExternalFolder(file.rootId, file.rel, opts.externalFolders ?? [])) return [];
      const symbols =
        onlyIds === null ? file.symbols : file.symbols.filter((s) => onlyIds.has(s.id));
      if (onlyIds !== null && symbols.length === 0) return [];
      const scoped = onlyIds === null ? file : { ...file, symbols };
      if (file.layer !== def.id || !matchMapFile(scoped, needle)) return [];
      if (!showTests && isTestFile(file.rel)) {
        hiddenTests += 1;
        return [];
      }
      if (!showConfig && isConfigFile(file.rel)) {
        hiddenConfigs += 1;
        return [];
      }
      return [scoped];
    }),
  })).filter((column) => column.files.length > 0 && layersOn[column.layer]);
  const visibleKeys = new Set<string>();
  for (const column of columns) {
    for (const file of column.files) visibleKeys.add(fileKey(file.rootId, file.rel));
  }
  return { columns, visibleKeys, hiddenTests, hiddenConfigs };
}

export function allLayersOn(): Record<ArchLayer, boolean> {
  return Object.fromEntries(ARCH_LAYERS.map((def) => [def.id, true])) as Record<
    ArchLayer,
    boolean
  >;
}

/**
 * Manual layer overrides by symbol id. The stored name guards stale
 * entries: an override applies only to the symbol it was made for.
 */
export type LayerOverrides = Record<string, { layer: ArchLayer; name: string }>;

export interface EffectiveLayer {
  layer: ArchLayer;
  reason: string;
  overridden: boolean;
}

/** Effective layer: a valid manual override wins, else the automatic verdict. */
export function effectiveLayer(node: ArchMapNode, overrides: LayerOverrides): EffectiveLayer {
  const found = overrides[node.id];
  if (
    found !== undefined &&
    found.name === node.symbol.name &&
    ARCH_LAYER_BY_ID[found.layer as ArchLayer] !== undefined
  ) {
    return {
      layer: found.layer,
      reason: `manual override (automatic: ${node.layerReason})`,
      overridden: true,
    };
  }
  return { layer: node.layer, reason: node.layerReason, overridden: false };
}

export interface FilteredSymbols {
  columns: SymbolColumn[];
  visibleIds: Set<string>;
  /** Symbols left out by the test/config toggles (never silent). */
  hiddenTests: number;
  hiddenConfigs: number;
}

export function matchMapNode(node: ArchMapNode, needle: string): boolean {
  if (needle === "") return true;
  const lower = needle.toLowerCase();
  return (
    node.rel.toLowerCase().includes(lower) ||
    node.symbol.name.toLowerCase().includes(lower) ||
    node.symbol.members.some((member) => member.name.toLowerCase().includes(lower))
  );
}

export interface SymbolFilterOpts extends MapFilterOpts {
  overrides?: LayerOverrides;
}

export function filterSymbolNodes(
  map: ArchMap | null,
  query: string,
  layersOn: Record<ArchLayer, boolean>,
  opts: SymbolFilterOpts = {},
): FilteredSymbols {
  const empty: FilteredSymbols = {
    columns: [],
    visibleIds: new Set(),
    hiddenTests: 0,
    hiddenConfigs: 0,
  };
  if (map === null) return empty;
  const needle = query.trim();
  const showTests = opts.showTests ?? true;
  const showConfig = opts.showConfig ?? true;
  const overrides = opts.overrides ?? {};
  let hiddenTests = 0;
  let hiddenConfigs = 0;
  const columns = ARCH_LAYERS.map((def) => ({
    layer: def.id,
    nodes: map.nodes.filter((node) => {
      if (isInExternalFolder(node.rootId, node.rel, opts.externalFolders ?? [])) return false;
      // Out-of-module nodes are not "hidden by filters": the module
      // criterion explains them, so they skip the hidden counters.
      if (opts.onlyIds != null && !opts.onlyIds.has(node.id)) {
        return false;
      }
      if (effectiveLayer(node, overrides).layer !== def.id) return false;
      if (!matchMapNode(node, needle)) return false;
      if (!showTests && isTestFile(node.rel)) {
        hiddenTests += 1;
        return false;
      }
      if (!showConfig && isConfigFile(node.rel)) {
        hiddenConfigs += 1;
        return false;
      }
      return true;
    }),
  })).filter((column) => column.nodes.length > 0 && layersOn[column.layer]);
  const visibleIds = new Set<string>();
  for (const column of columns) {
    for (const node of column.nodes) visibleIds.add(node.id);
  }
  return { columns, visibleIds, hiddenTests, hiddenConfigs };
}
