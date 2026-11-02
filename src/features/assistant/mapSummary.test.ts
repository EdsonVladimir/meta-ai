// Session map summaries: extraction, per-root rendering with caps,
// and publish/clear. No IO, no network.
import { describe, expect, it } from "vitest";
import type { ArchLayer } from "../code/archmap/archLayers";
import type { ArchMap, ArchMapNode } from "../code/archmap/archModel";
import {
  clearMapSummaries,
  detectedForRoots,
  MAP_SUMMARY_MAX_CHARS,
  mapSectionsForRoots,
  publishDetectedServices,
  publishMapSection,
  renderRootSummary,
  summarizeSection,
  type MapSectionSummary,
} from "./mapSummary";

function node(
  id: string,
  layer: ArchLayer,
  name: string,
  kind: ArchMapNode["symbol"]["kind"] = "class",
  members = 1,
): ArchMapNode {
  return {
    id,
    rootId: "r",
    rel: "a.ts",
    layer,
    layerReason: "test",
    symbol: {
      id,
      kind,
      name,
      rootId: "r",
      rel: "a.ts",
      members: Array.from({ length: members }, (_, i) => ({
        name: `m${i}`,
        kind: "method",
        detail: "()",
      })),
      membersTruncated: false,
      decorators: [],
      unresolved: [],
      unresolvedTruncated: false,
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
  } as ArchMapNode;
}

function emptyMap(): ArchMap {
  return {
    files: [],
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
}

function section(overrides: Partial<MapSectionSummary> = {}): MapSectionSummary {
  return {
    key: "r::",
    rootId: "r",
    rootName: "shop",
    title: "shop",
    rel: "",
    kind: "implicit",
    filesAnalyzed: 2,
    partial: false,
    layers: [{ layer: "services", symbols: 1 }],
    routes: [],
    classes: [],
    ...overrides,
  };
}

describe("summarizeSection", () => {
  it("counts layers largest-first and keeps the largest classes", () => {
    const map = {
      ...emptyMap(),
      nodes: [
        node("1", "services", "Small", "class", 1),
        node("2", "ui", "Big", "component", 9),
        node("3", "services", "Mid", "class", 4),
        node("4", "ui", "Tiny", "class", 0),
        node("5", "services", "Helper", "function", 30),
      ],
    };
    const summary = summarizeSection({
      key: "r::",
      rootId: "r",
      rootName: "shop",
      title: "shop",
      rel: "",
      kind: "implicit",
      map,
      routes: [
        { rel: "app.ts", path: "/sales", component: "SalesPage", lazyImport: null, loadsChildren: false, canActivate: [], evidence: "t" },
        { rel: "app.ts", path: null, component: "Lazy", lazyImport: null, loadsChildren: true, canActivate: [], evidence: "t" },
      ],
      filesAnalyzed: 2,
      partial: true,
    });
    expect(summary.layers).toEqual([
      { layer: "services", symbols: 3 },
      { layer: "ui", symbols: 2 },
    ]);
    // Functions are not classes; largest first, ties by name.
    expect(summary.classes.map((item) => item.name)).toEqual(["Big", "Mid", "Small", "Tiny"]);
    expect(summary.routes).toEqual([
      { path: "/sales", component: "SalesPage" },
      { path: "(computed path)", component: "Lazy" },
    ]);
    expect(summary.partial).toBe(true);
  });

  it("keeps routes null when the result is missing", () => {
    const summary = summarizeSection({
      key: "r::",
      rootId: "r",
      rootName: "shop",
      title: "shop",
      rel: "",
      kind: "implicit",
      map: emptyMap(),
      routes: null,
      filesAnalyzed: 1,
      partial: true,
    });
    expect(summary.routes).toBeNull();
  });
});

describe("renderRootSummary", () => {
  it("names services, layers, routes and classes, largest first", () => {
    const text = renderRootSummary(
      { id: "r", name: "shop" },
      [
        section({
          title: "api",
          rel: "api",
          kind: "project",
          filesAnalyzed: 34,
          layers: [
            { layer: "services", symbols: 12 },
            { layer: "ui", symbols: 9 },
          ],
          routes: [{ path: "/sales", component: "SalesPage" }],
          classes: [{ name: "SalesService", members: 18 }],
        }),
      ],
      ["web"],
    );
    expect(text).toContain("Root: shop (r)");
    expect(text).toContain("Analyzed services (1): api");
    expect(text).toContain("Not analyzed (1): web");
    expect(text).toContain("- api (folder api, 34 files analyzed)");
    const services = text.indexOf("Services 12 symbols");
    const ui = text.indexOf("UI Components 9 symbols");
    expect(services).toBeGreaterThan(-1);
    expect(services).toBeLessThan(ui);
    expect(text).toContain("Routes: /sales -> SalesPage");
    expect(text).toContain("Main classes: SalesService (18 members)");
  });

  it("renders empty without an analyzed service", () => {
    expect(renderRootSummary({ id: "r", name: "shop" }, [], ["web"])).toBe("");
    expect(renderRootSummary({ id: "r", name: "shop" }, [], [])).toBe("");
  });

  it("caps routes, classes and the whole text, saying so", () => {
    const routes = Array.from({ length: 25 }, (_, i) => ({
      path: `/r${i}`,
      component: `C${i}`,
    }));
    const classes = Array.from({ length: 25 }, (_, i) => ({ name: `K${i}`, members: i }));
    const text = renderRootSummary(
      { id: "r", name: "shop" },
      [section({ routes, classes })],
      [],
    );
    expect(text).toContain("(+5 more)");
    expect(text).not.toContain("/r20");
    const big = renderRootSummary(
      { id: "r", name: "shop" },
      [section({ classes: [{ name: "K".repeat(MAP_SUMMARY_MAX_CHARS), members: 1 }] })],
      [],
    );
    expect(big.length).toBeLessThanOrEqual(MAP_SUMMARY_MAX_CHARS);
    expect(big).toContain(`showing ${MAP_SUMMARY_MAX_CHARS} of`);
  });

  it("marks partial maps and unknown routes honestly", () => {
    const text = renderRootSummary(
      { id: "r", name: "shop" },
      [section({ partial: true, routes: null, classes: [], layers: [] })],
      [],
    );
    expect(text).toContain("partial");
    expect(text).toContain("Routes: unknown (analysis incomplete)");
    expect(text).toContain("Main classes: none found");
    expect(text).toContain("Layers: none");
  });
});

describe("session store", () => {
  it("publishes per section, replaces detected, and clears all", () => {
    clearMapSummaries();
    publishMapSection(section({ key: "r::a", title: "a" }));
    publishMapSection(section({ key: "r::a", title: "a2" }));
    publishMapSection(section({ key: "x::b", rootId: "x", title: "b" }));
    publishDetectedServices([
      { key: "r::a", rootId: "r", name: "a" },
      { key: "x::b", rootId: "x", name: "b" },
    ]);
    expect(mapSectionsForRoots(["r"]).map((item) => item.title)).toEqual(["a2"]);
    expect(detectedForRoots(["r"]).map((item) => item.name)).toEqual(["a"]);
    publishDetectedServices([]);
    expect(detectedForRoots(["r"])).toEqual([]);
    clearMapSummaries();
    expect(mapSectionsForRoots(["r", "x"])).toEqual([]);
  });
});
