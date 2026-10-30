// mapFilter: layer toggles, test/config toggles with honest counts,
// plus search over paths, symbols, members. Symbol projections
// filter separately with manual layer overrides.
import { describe, expect, it } from "vitest";
import {
  allLayersOn,
  effectiveLayer,
  filterMapColumns,
  filterSymbolNodes,
  isConfigFile,
  isTestFile,
  matchMapFile,
} from "./mapFilter";
import type { ArchMap, ArchMapFile, ArchMapNode } from "./archModel";

function file(overrides: Partial<ArchMapFile> & { rel: string }): ArchMapFile {
  return {
    rootId: "root-1",
    layer: "services",
    layerReason: "test",
    symbols: [],
    unresolved: [],
    unresolvedTruncated: false,
    externals: [],
    missing: [],
    ...overrides,
  };
}

function symbol(name: string, memberNames: string[] = []) {
  return {
    id: `s-${name}`,
    kind: "class" as const,
    name,
    rootId: "root-1",
    rel: "a.ts",
    members: memberNames.map((member) => ({ name: member, kind: "method" as const, detail: "()" })),
    membersTruncated: false,
    decorators: [],
    unresolved: [],
    unresolvedTruncated: false,
    range: { startLine: 1, startCol: 1, endLine: 2, endCol: 1 },
  };
}

describe("matchMapFile", () => {
  const candidate = file({
    rel: "src/sales.service.ts",
    symbols: [symbol("SalesService", ["all", "repo"])],
  });
  it("matches empty queries, paths, symbols and members", () => {
    expect(matchMapFile(candidate, "")).toBe(true);
    expect(matchMapFile(candidate, "sales")).toBe(true);
    expect(matchMapFile(candidate, "SALESSERVICE")).toBe(true);
    expect(matchMapFile(candidate, "repo")).toBe(true);
    expect(matchMapFile(candidate, "controller")).toBe(false);
  });
});

describe("test and config detection", () => {
  it("spots spec/test siblings", () => {
    expect(isTestFile("src/a.spec.ts")).toBe(true);
    expect(isTestFile("src/a.test.tsx")).toBe(true);
    expect(isTestFile("src/a.service.ts")).toBe(false);
    expect(isTestFile("src/contest/page.ts")).toBe(false);
  });

  it("spots config and environment files", () => {
    expect(isConfigFile("vite.config.ts")).toBe(true);
    expect(isConfigFile("src/app.config.ts")).toBe(true);
    expect(isConfigFile("src/environments/environment.ts")).toBe(true);
    expect(isConfigFile("environments/prod.ts")).toBe(true);
    expect(isConfigFile("src/a.service.ts")).toBe(false);
    expect(isConfigFile("src/configuration.ts")).toBe(false);
  });
});

describe("filterMapColumns", () => {
  const map: ArchMap = {
    files: [
      file({ rel: "src/a.controller.ts", layer: "controllers", symbols: [symbol("A")] }),
      file({ rel: "src/b.service.ts", layer: "services", symbols: [symbol("B")] }),
      file({ rel: "src/b.service.spec.ts", layer: "unassigned", symbols: [] }),
      file({ rel: "src/app.config.ts", layer: "crosscutting", symbols: [] }),
    ],
    filesTruncated: false,
    edges: [],
    edgesTruncated: false,
    nodes: [],
    nodesTruncated: false,
    symbolEdges: [],
    symbolEdgesTruncated: false,
    modules: [],
    externals: [],
    externalsTruncated: false,
    skipped: [],
  };

  it("keeps every column without filters", () => {
    const filtered = filterMapColumns(map, "", allLayersOn());
    expect(filtered.columns.map((column) => column.layer)).toEqual([
      "controllers",
      "services",
      "crosscutting",
      "unassigned",
    ]);
    expect(filtered.visibleKeys.size).toBe(4);
    expect(filtered.hiddenTests).toBe(0);
    expect(filtered.hiddenConfigs).toBe(0);
  });

  it("applies layer toggles and search together", () => {
    const layers = { ...allLayersOn(), services: false };
    const filtered = filterMapColumns(map, "a.controller", layers);
    expect(filtered.columns).toHaveLength(1);
    expect(filtered.columns[0].files[0].rel).toBe("src/a.controller.ts");
    expect(filterMapColumns(map, "zzz", allLayersOn()).columns).toHaveLength(0);
  });

  it("hides tests and configs only through their toggles, counted", () => {
    const filtered = filterMapColumns(map, "", allLayersOn(), {
      showTests: false,
      showConfig: false,
    });
    expect(filtered.visibleKeys.size).toBe(2);
    expect(filtered.hiddenTests).toBe(1);
    expect(filtered.hiddenConfigs).toBe(1);
  });

  it("returns empty sets for a null map", () => {
    expect(filterMapColumns(null, "", allLayersOn())).toEqual({
      columns: [],
      visibleKeys: new Set(),
      hiddenTests: 0,
      hiddenConfigs: 0,
    });
  });
});

describe("filterSymbolNodes", () => {
  const svc = file({
    rel: "src/b.service.ts",
    layer: "services",
    symbols: [symbol("BillingService", ["all"]), symbol("OrderDto", [])],
  });
  const spec = file({
    rel: "src/b.service.spec.ts",
    layer: "unassigned",
    symbols: [symbol("BillingServiceSpec", [])],
  });
  function node(
    symbol: (typeof svc.symbols)[number],
    layer: "services" | "contracts" | "unassigned",
    rel: string,
  ): ArchMapNode {
    return {
      id: symbol.id,
      rootId: "root-1",
      rel,
      symbol: { ...symbol, rel },
      layer,
      layerReason: "test",
    };
  }
  const map: ArchMap = {
    files: [svc, spec],
    filesTruncated: false,
    edges: [],
    edgesTruncated: false,
    nodes: [
      node(svc.symbols[0], "services", svc.rel),
      node(svc.symbols[1], "contracts", svc.rel),
      node(spec.symbols[0], "unassigned", spec.rel),
    ],
    nodesTruncated: false,
    symbolEdges: [],
    symbolEdgesTruncated: false,
    modules: [],
    externals: [],
    externalsTruncated: false,
    skipped: [],
  };

  it("groups symbols by their own layer", () => {
    const filtered = filterSymbolNodes(map, "", allLayersOn());
    expect(filtered.columns.map((column) => column.layer)).toEqual([
      "services",
      "contracts",
      "unassigned",
    ]);
    expect(filtered.visibleIds.size).toBe(3);
    // One file, two layers: no forced joint classification.
    expect(
      filtered.columns.find((column) => column.layer === "contracts")?.nodes.map((n) => n.symbol.name),
    ).toEqual(["OrderDto"]);
  });

  it("matches names, members and paths", () => {
    expect(filterSymbolNodes(map, "orderdto", allLayersOn()).visibleIds.size).toBe(1);
    expect(filterSymbolNodes(map, "all", allLayersOn()).visibleIds.size).toBe(1);
    expect(filterSymbolNodes(map, "zzz", allLayersOn()).columns).toHaveLength(0);
    const layers = { ...allLayersOn(), services: false };
    expect(filterSymbolNodes(map, "", layers).visibleIds.size).toBe(2);
  });

  it("counts test symbols left out by their toggle", () => {
    const filtered = filterSymbolNodes(map, "", allLayersOn(), { showTests: false });
    expect(filtered.visibleIds.size).toBe(2);
    expect(filtered.hiddenTests).toBe(1);
    expect(filtered.hiddenConfigs).toBe(0);
  });

  it("returns empty sets for a null map", () => {
    expect(filterSymbolNodes(null, "", allLayersOn())).toEqual({
      columns: [],
      visibleIds: new Set(),
      hiddenTests: 0,
      hiddenConfigs: 0,
    });
  });
});

describe("effectiveLayer", () => {
  const svc = file({
    rel: "src/b.service.ts",
    layer: "services",
    symbols: [symbol("BillingService", ["all"])],
  });
  const target: ArchMapNode = {
    id: svc.symbols[0].id,
    rootId: "root-1",
    rel: svc.rel,
    symbol: svc.symbols[0],
    layer: "services",
    layerReason: "name suffix",
  };

  it("prefers a valid manual override", () => {
    const verdict = effectiveLayer(target, {
      [target.id]: { layer: "state", name: "BillingService" },
    });
    expect(verdict).toEqual({
      layer: "state",
      reason: "manual override (automatic: name suffix)",
      overridden: true,
    });
  });

  it("ignores stale or unknown overrides", () => {
    expect(effectiveLayer(target, {}).overridden).toBe(false);
    // Renamed symbol: the stored name no longer matches.
    expect(
      effectiveLayer(target, { [target.id]: { layer: "state", name: "Other" } }),
    ).toEqual({ layer: "services", reason: "name suffix", overridden: false });
    // Unknown layer id from a corrupt entry.
    expect(
      effectiveLayer(target, {
        [target.id]: { layer: "nonsense" as "services", name: "BillingService" },
      }).overridden,
    ).toBe(false);
  });
});

describe("module filter (onlyIds)", () => {
  const map: ArchMap = {
    files: [
      file({
        rel: "src/mixed.ts",
        layer: "services",
        symbols: [symbol("InModule"), symbol("Elsewhere")],
      }),
      file({ rel: "src/other.ts", layer: "services", symbols: [symbol("Other")] }),
    ],
    filesTruncated: false,
    edges: [],
    edgesTruncated: false,
    nodes: [],
    nodesTruncated: false,
    symbolEdges: [],
    symbolEdgesTruncated: false,
    modules: [],
    externals: [],
    externalsTruncated: false,
    skipped: [],
  };
  const nodes: ArchMapNode[] = [
    {
      id: "s-InModule",
      rootId: "root-1",
      rel: "src/mixed.ts",
      symbol: map.files[0].symbols[0],
      layer: "services",
      layerReason: "test",
    },
    {
      id: "s-Elsewhere",
      rootId: "root-1",
      rel: "src/mixed.ts",
      symbol: map.files[0].symbols[1],
      layer: "services",
      layerReason: "test",
    },
  ];
  const nodeMap: ArchMap = { ...map, nodes };

  it("keeps member symbols and drops their files' siblings", () => {
    const filtered = filterMapColumns(map, "", allLayersOn(), {
      onlyIds: new Set(["s-InModule"]),
    });
    expect(filtered.columns).toHaveLength(1);
    expect(filtered.columns[0].files).toHaveLength(1);
    expect(filtered.columns[0].files[0].rel).toBe("src/mixed.ts");
    expect(filtered.columns[0].files[0].symbols.map((s) => s.name)).toEqual(["InModule"]);
    expect(filtered.visibleKeys.size).toBe(1);
  });

  it("matches search against member symbols only", () => {
    const filtered = filterMapColumns(map, "elsewhere", allLayersOn(), {
      onlyIds: new Set(["s-InModule"]),
    });
    expect(filtered.columns).toHaveLength(0);
  });

  it("filters symbol nodes without touching hidden counters", () => {
    const filtered = filterSymbolNodes(nodeMap, "", allLayersOn(), {
      onlyIds: new Set(["s-InModule"]),
    });
    expect(filtered.columns).toHaveLength(1);
    expect(filtered.columns[0].nodes.map((n) => n.id)).toEqual(["s-InModule"]);
    expect(filtered.hiddenTests).toBe(0);
    expect(filtered.hiddenConfigs).toBe(0);
  });

  it("ignores a null module filter", () => {
    expect(filterMapColumns(map, "", allLayersOn(), { onlyIds: null }).visibleKeys.size).toBe(2);
    expect(
      filterSymbolNodes(nodeMap, "", allLayersOn(), { onlyIds: null }).visibleIds.size,
    ).toBe(2);
  });
});
