import { describe, expect, it } from "vitest";
import {
  ancestorsForSelection,
  artifactNodeId,
  buildForest,
  findTypeahead,
  firstLine,
  flattenVisible,
  groupNodeId,
  isFocusable,
  linkNodeId,
  moduleKey,
  moduleNodeId,
  projectNodeId,
  toggleExpanded,
  type ForestInput,
} from "./explorerModel";

function input(overrides: Partial<ForestInput> = {}): ForestInput {
  return {
    projects: [{ id: "proj-1", name: "proj-1" }],
    modulesByProject: {},
    artifactsByModule: {},
    loadingKeys: [],
    errorKeys: {},
    expanded: [],
    selection: { projectId: null, moduleId: null, requirementId: null, designId: null, mockupId: null, screenId: null },
    meta: {},
    designLinks: {},
    linksStatus: {},
    mockupScreens: {},
    showArchived: false,
    ...overrides,
  };
}

describe("node ids", () => {
  it("stay stable and unique per level", () => {
    expect(projectNodeId("p")).toBe("p:p");
    expect(moduleNodeId("p", "m")).toBe("m:p/m");
    expect(groupNodeId("p", "m", "req")).toBe("g:p/m/req");
    expect(artifactNodeId("p", "m", "a")).toBe("a:p/m/a");
    expect(linkNodeId("r", "d")).toBe("l:r/d");
    expect(moduleKey("p", "m")).toBe("p/m");
  });
});

describe("firstLine", () => {
  it("takes the first line and collapses spaces", () => {
    expect(firstLine("  Confirm  sale\nsecond line  ")).toBe("Confirm sale");
  });

  it("truncates with an ellipsis without inventing text", () => {
    expect(firstLine("abcdefghij", 6)).toBe("abcde…");
    expect(firstLine("corto", 60)).toBe("corto");
  });

  it("empties on blank content", () => {
    expect(firstLine("  \n  ")).toBe("");
  });
});

describe("toggleExpanded", () => {
  it("adds and removes without duplicating", () => {
    expect(toggleExpanded([], "p:a")).toEqual(["p:a"]);
    expect(toggleExpanded(["p:a", "p:b"], "p:a")).toEqual(["p:b"]);
  });
});

describe("ancestorsForSelection", () => {
  it("expands the artifact project, module and group", () => {
    expect(ancestorsForSelection("p", "m", "r", null)).toEqual([
      "p:p",
      "m:p/m",
      "g:p/m/req",
    ]);
    expect(ancestorsForSelection("p", "m", null, "d")).toEqual([
      "p:p",
      "m:p/m",
      "g:p/m/design",
    ]);
  });

  it("without a module expands only the project; without anything, empty", () => {
    expect(ancestorsForSelection("p", null, null, null)).toEqual(["p:p"]);
    expect(ancestorsForSelection(null, null, null, null)).toEqual([]);
  });
});

describe("buildForest", () => {
  const modules = [{ id: "mod-1", projectId: "proj-1", name: "mod-1", archived: false }];
  const artifacts = [
    { id: "req-1", projectId: "proj-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
    { id: "flujo-2", projectId: "proj-1", moduleId: "mod-1", kind: "flow", title: null, archived: false },
  ];

  it("collapsed shows only projects", () => {
    const forest = buildForest(input());
    expect(forest.map((n) => n.id)).toEqual(["p:proj-1"]);
    expect(forest[0].expandable).toBe(true);
    expect(forest[0].expanded).toBe(false);
  });

  it("expands the full hierarchy with groups and artifacts", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/req", "g:proj-1/mod-1/design"],
      }),
    );
    const rows = flattenVisible(forest).map((n) => n.id);
    expect(rows).toEqual([
      "p:proj-1",
      "m:proj-1/mod-1",
      "g:proj-1/mod-1/req",
      "a:proj-1/mod-1/req-1",
      "g:proj-1/mod-1/design",
      "a:proj-1/mod-1/flujo-2",
      "g:proj-1/mod-1/mockup",
    ]);
  });

  it("marks the selection at its exact level", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/req"],
        selection: { projectId: "proj-1", moduleId: "mod-1", requirementId: "req-1", designId: null, mockupId: null, screenId: null },
      }),
    );
    const selected = flattenVisible(forest).filter((n) => n.selected);
    expect(selected.map((n) => n.id)).toEqual(["a:proj-1/mod-1/req-1"]);
  });

  it("uses the known label and keeps the ID as secondary", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/req"],
        meta: { "req-1": { label: "Confirmar venta", approved: true } },
      }),
    );
    const row = flattenVisible(forest).find((n) => n.artifactId === "req-1");
    expect(row?.label).toBe("Confirmar venta");
    expect(row?.secondary).toBe("req-1");
    expect(row?.title).toBe("Confirmar venta — req-1");
    expect(row?.approved).toBe(true);
  });

  it("when the known label equals the ID there is no secondary", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/req"],
        meta: { "req-1": { label: "req-1", approved: false } },
      }),
    );
    const row = flattenVisible(forest).find((n) => n.artifactId === "req-1");
    expect(row?.label).toBe("req-1");
    expect(row?.secondary).toBeNull();
    expect(row?.approved).toBe(false);
  });

  it("without metadata the ID is the label and there is no badge", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/design"],
      }),
    );
    const row = flattenVisible(forest).find((n) => n.artifactId === "flujo-2");
    expect(row?.label).toBe("flujo-2");
    expect(row?.secondary).toBeNull();
    expect(row?.approved).toBeNull();
    expect(row?.artifactKind).toBe("flow");
  });

  it("shows loading, error and empty per container (projects show no empty row)", () => {
    const loading = buildForest(input({ expanded: ["p:proj-1"], loadingKeys: ["p:proj-1"] }));
    expect(loading[0].children[0].loadState).toBe("loading");
    const failed = buildForest(
      input({ expanded: ["p:proj-1"], errorKeys: { "p:proj-1": "Fallo" } }),
    );
    expect(failed[0].children[0].loadState).toBe("error");
    expect(failed[0].children[0].label).toBe("Fallo");
    // A project without (visible) modules lists nothing under it:
    // no "No modules" placeholder row.
    const empty = buildForest(
      input({ expanded: ["p:proj-1"], modulesByProject: { "proj-1": [] } }),
    );
    expect(empty[0].children).toEqual([]);
  });

  it("states are not focusable", () => {
    const forest = buildForest(input({ expanded: ["p:proj-1"], loadingKeys: ["p:proj-1"] }));
    const rows = flattenVisible(forest);
    expect(isFocusable(rows[0])).toBe(true);
    expect(isFocusable(rows[1])).toBe(false);
  });
});

describe("findTypeahead", () => {
  it("jumps to the next matching visible row and wraps around", () => {
    const forest = buildForest(
      input({
        projects: [{ id: "alfa", name: "alfa" }, { id: "beta", name: "beta" }, { id: "alce", name: "alce" }],
      }),
    );
    const rows = flattenVisible(forest);
    expect(findTypeahead(rows, 0, "b")).toBe(1);
    expect(findTypeahead(rows, 1, "a")).toBe(2);
    expect(findTypeahead(rows, 2, "z")).toBe(2);
  });
});

describe("designs linked under requirements", () => {
  const modules = [{ id: "mod-1", projectId: "proj-1", name: "mod-1", archived: false }];
  const artifacts = [
    { id: "req-1", projectId: "proj-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
    { id: "flujo-2", projectId: "proj-1", moduleId: "mod-1", kind: "flow", title: null, archived: false },
  ];
  const links = {
    "req-1": [
      { artifactId: "flujo-2", kind: "flow", link: "direct" as const, stale: false, pinnedVersions: ["req-1-v2"], via: [] },
    ],
  };
  const open = [
    "p:proj-1",
    "m:proj-1/mod-1",
    "g:proj-1/mod-1/req",
    "g:proj-1/mod-1/design",
    "a:proj-1/mod-1/req-1",
  ];

  it("the expanded requirement shows shortcuts to the same artifact", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: open,
        designLinks: links,
      }),
    );
    const rows = flattenVisible(forest);
    const access = rows.find((n) => n.id === "l:req-1/flujo-2");
    expect(access?.kind).toBe("design");
    expect(access?.artifactId).toBe("flujo-2");
    expect(access?.linkKind).toBe("direct");
    expect(access?.staleLink).toBe(false);
    // The module index keeps the same artifact.
    expect(rows.some((n) => n.id === "a:proj-1/mod-1/flujo-2")).toBe(true);
  });

  it("tells transitive links apart and marks staleness", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: open,
        designLinks: {
          "req-1": [
            { artifactId: "mer-3", kind: "data_model", link: "transitive", stale: true, pinnedVersions: [], via: ["flujo-2"] },
          ],
        },
      }),
    );
    const rows = flattenVisible(forest);
    const access = rows.find((n) => n.id === "l:req-1/mer-3");
    expect(access?.linkKind).toBe("transitive");
    expect(access?.staleLink).toBe(true);
    expect(access?.artifactKind).toBe("data_model");
  });

  it("without links shows an honest empty state", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: open,
        designLinks: { "req-1": [] },
      }),
    );
    const rows = flattenVisible(forest);
    expect(rows.some((n) => n.loadState === "empty" && n.label === "No linked designs")).toBe(true);
  });

  it("mockups live in their group with their node kind", () => {
    const withMockup = [
      ...artifacts,
      { id: "mockup-1", projectId: "proj-1", moduleId: "mod-1", kind: "mockup", title: null, archived: false },
    ];
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": withMockup },
        expanded: [...open, "g:proj-1/mod-1/mockup"],
        designLinks: links,
      }),
    );
    const rows = flattenVisible(forest);
    const group = rows.find((n) => n.id === "g:proj-1/mod-1/mockup");
    expect(group?.kind).toBe("mockupGroup");
    const row = rows.find((n) => n.id === "a:proj-1/mod-1/mockup-1");
    expect(row?.kind).toBe("mockup");
    expect(row?.artifactKind).toBe("mockup");
    // And they never show in the designs group.
    const designRows = rows.filter((n) => n.kind === "design" && n.artifactId === "mockup-1");
    expect(designRows).toHaveLength(0);
  });

  it("mockup shortcuts keep their kind and selection", () => {
    const withMockup = [
      ...artifacts,
      { id: "mockup-1", projectId: "proj-1", moduleId: "mod-1", kind: "mockup", title: null, archived: false },
    ];
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": withMockup },
        expanded: [...open, "g:proj-1/mod-1/mockup"],
        designLinks: {
          "req-1": [
            { artifactId: "mockup-1", kind: "mockup", link: "direct" as const, stale: false, pinnedVersions: [], via: [] },
          ],
        },
        selection: { projectId: "proj-1", moduleId: "mod-1", requirementId: "req-1", designId: null, mockupId: "mockup-1", screenId: null },
      }),
    );
    const rows = flattenVisible(forest);
    const link = rows.find((n) => n.id === "l:req-1/mockup-1");
    expect(link?.kind).toBe("mockup");
    expect(link?.selected).toBe(true);
    const canonical = rows.find((n) => n.id === "a:proj-1/mod-1/mockup-1");
    expect(canonical?.selected).toBe(true);
  });

  it("without data shows loading or error with retry", () => {
    const loading = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: open,
      }),
    );
    expect(flattenVisible(loading).some((n) => n.loadState === "loading")).toBe(true);
    const failed = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: open,
        linksStatus: { "proj-1/mod-1": { status: "error", error: "Fallo" } },
      }),
    );
    const rows = flattenVisible(failed);
    const status = rows.find((n) => n.loadState === "error");
    expect(status?.label).toBe("Fallo");
    expect(status?.moduleId).toBe("mod-1");
  });

  it("mockups expand into their derived screens", () => {
    const withMockup = [
      ...artifacts,
      { id: "mockup-1", projectId: "proj-1", moduleId: "mod-1", kind: "mockup", title: "Reserva", archived: false },
    ];
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": withMockup },
        expanded: [...open, "g:proj-1/mod-1/mockup", "a:proj-1/mod-1/mockup-1"],
        mockupScreens: {
          "mockup-1": {
            screens: [{ id: "registro", title: "Registro", components: 3 }],
            unparsed: false,
          },
        },
      }),
    );
    const rows = flattenVisible(forest);
    const mockup = rows.find((n) => n.id === "a:proj-1/mod-1/mockup-1");
    expect(mockup?.expandable).toBe(true);
    const screen = rows.find((n) => n.id === "s:mockup-1/registro");
    expect(screen?.kind).toBe("screen");
    expect(screen?.label).toBe("Registro");
    expect(screen?.artifactId).toBe("mockup-1");
    expect(screen?.screenId).toBe("registro");
  });

  it("the selected screen marks its row and expands ancestors", () => {
    const withMockup = [
      ...artifacts,
      { id: "mockup-1", projectId: "proj-1", moduleId: "mod-1", kind: "mockup", title: null, archived: false },
    ];
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": withMockup },
        expanded: [...open, "g:proj-1/mod-1/mockup", "a:proj-1/mod-1/mockup-1"],
        mockupScreens: {
          "mockup-1": { screens: [{ id: "p", title: "P", components: 0 }], unparsed: false },
        },
        selection: { projectId: "proj-1", moduleId: "mod-1", requirementId: null, designId: null, mockupId: "mockup-1", screenId: "p" },
      }),
    );
    const screen = flattenVisible(forest).find((n) => n.id === "s:mockup-1/p");
    expect(screen?.selected).toBe(true);
    expect(ancestorsForSelection("proj-1", "mod-1", null, null, "mockup-1", "p")).toContain(
      "a:proj-1/mod-1/mockup-1",
    );
  });

  it("without a graph shows loading; unreadable shows honest error", () => {
    const withMockup = [
      ...artifacts,
      { id: "mockup-1", projectId: "proj-1", moduleId: "mod-1", kind: "mockup", title: null, archived: false },
    ];
    const loading = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": withMockup },
        expanded: [...open, "g:proj-1/mod-1/mockup", "a:proj-1/mod-1/mockup-1"],
        linksStatus: { "proj-1/mod-1": { status: "loading", error: null } },
      }),
    );
    expect(flattenVisible(loading).some((n) => n.loadState === "loading")).toBe(true);
    const broken = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": withMockup },
        expanded: [...open, "g:proj-1/mod-1/mockup", "a:proj-1/mod-1/mockup-1"],
        mockupScreens: { "mockup-1": { screens: [], unparsed: true } },
      }),
    );
    const status = flattenVisible(broken).find((n) => n.loadState === "error");
    expect(status?.label).toContain("Unreadable");
  });

  it("the group keeps the module full index", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded: open,
        designLinks: links,
      }),
    );
    const group = flattenVisible(forest).find((n) => n.id === "g:proj-1/mod-1/design");
    expect(group?.label).toBe("Module designs");
    expect(group?.count).toBe(1);
  });
});

describe("archived items", () => {
  const modules = [
    { id: "mod-1", projectId: "proj-1", name: "mod-1", archived: false },
    { id: "mod-old", projectId: "proj-1", name: "mod-old", archived: true },
  ];
  const artifacts = [
    { id: "req-1", projectId: "proj-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
    { id: "req-old", projectId: "proj-1", moduleId: "mod-1", kind: "requirement", title: null, archived: true },
  ];
  const expanded = ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/req"];

  it("without showing archived, modules and artifacts filter out", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded,
      }),
    );
    const rows = flattenVisible(forest).map((n) => n.id);
    expect(rows).not.toContain("m:proj-1/mod-old");
    expect(rows).toContain("a:proj-1/mod-1/req-1");
    expect(rows).not.toContain("a:proj-1/mod-1/req-old");
    const group = flattenVisible(forest).find((n) => n.id === "g:proj-1/mod-1/req");
    expect(group?.count).toBe(1);
    expect(group?.hiddenArchived).toBe(1);
  });

  it("showing them marks them and emptiness stays honest", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-old": [] },
        expanded: ["p:proj-1", "m:proj-1/mod-old", "g:proj-1/mod-old/req"],
        showArchived: true,
      }),
    );
    const rows = flattenVisible(forest);
    const mod = rows.find((n) => n.id === "m:proj-1/mod-old");
    expect(mod?.archived).toBe(true);
    const shown = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: { "proj-1/mod-1": artifacts },
        expanded,
        showArchived: true,
      }),
    );
    const req = flattenVisible(shown).find((n) => n.artifactId === "req-old");
    expect(req?.archived).toBe(true);
    // Without the switch and everything archived, emptiness says so.
    const hidden = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: {
          "proj-1/mod-1": artifacts.filter((a) => a.archived),
        },
        expanded,
      }),
    );
    const status = flattenVisible(hidden).find((n) => n.kind === "status");
    expect(status?.label).toBe("No requirements (1 archived)");
  });

  it("module archiving marks its contents by context", () => {
    const forest = buildForest(
      input({
        modulesByProject: { "proj-1": modules },
        artifactsByModule: {
          "proj-1/mod-old": [
            { id: "req-2", projectId: "proj-1", moduleId: "mod-old", kind: "requirement", title: null, archived: false },
          ],
        },
        expanded: ["p:proj-1", "m:proj-1/mod-old", "g:proj-1/mod-old/req"],
        showArchived: true,
      }),
    );
    const row = flattenVisible(forest).find((n) => n.artifactId === "req-2");
    expect(row?.archived).toBe(true);
  });
});

describe("names and titles", () => {
  const named = input({
    projects: [{ id: "proj-1", name: "Tienda" }],
    modulesByProject: {
      "proj-1": [{ id: "mod-1", projectId: "proj-1", name: "Ventas", archived: false }],
    },
    artifactsByModule: {
      "proj-1/mod-1": [
        { id: "req-1", projectId: "proj-1", moduleId: "mod-1", kind: "requirement", title: "Confirmar venta", archived: false },
        { id: "req-2", projectId: "proj-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
        { id: "flujo-3", projectId: "proj-1", moduleId: "mod-1", kind: "flow", title: "Flujo de caja", archived: false },
      ],
    },
    meta: { "req-2": { label: "Reservar antes de confirmar", approved: false } },
    expanded: ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/req", "g:proj-1/mod-1/design"],
  });

  it("shows names and keeps the ID as secondary", () => {
    const rows = flattenVisible(buildForest(named));
    const byId = (id: string) => rows.find((n) => n.id === id);
    expect(byId("p:proj-1")?.label).toBe("Tienda");
    expect(byId("p:proj-1")?.secondary).toBe("proj-1");
    expect(byId("m:proj-1/mod-1")?.label).toBe("Ventas");
    expect(byId("m:proj-1/mod-1")?.secondary).toBe("mod-1");
    const req = byId("a:proj-1/mod-1/req-1");
    expect(req?.label).toBe("Confirmar venta");
    expect(req?.secondary).toBe("req-1");
    expect(req?.title).toContain("Confirmar venta");
    expect(req?.title).toContain("req-1");
  });

  it("without a title uses the derived first line, without meta the ID", () => {
    const rows = flattenVisible(buildForest(named));
    const derived = rows.find((n) => n.artifactId === "req-2");
    expect(derived?.label).toBe("Reservar antes de confirmar");
    expect(derived?.secondary).toBe("req-2");
    const plain = flattenVisible(
      buildForest(
        input({
          modulesByProject: {
            "proj-1": [{ id: "mod-1", projectId: "proj-1", name: "mod-1", archived: false }],
          },
          artifactsByModule: {
            "proj-1/mod-1": [
              { id: "req-9", projectId: "proj-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
            ],
          },
          expanded: ["p:proj-1", "m:proj-1/mod-1", "g:proj-1/mod-1/req"],
        }),
      ),
    );
    const fallback = plain.find((n) => n.artifactId === "req-9");
    expect(fallback?.label).toBe("req-9");
    expect(fallback?.secondary).toBeNull();
  });

  it("the title wins over the derived label and shortcuts inherit it", () => {
    const forest = buildForest({
      ...named,
      designLinks: {
        "req-1": [
          { artifactId: "flujo-3", kind: "flow", link: "direct" as const, stale: false, pinnedVersions: [], via: [] },
        ],
      },
      expanded: [...named.expanded, "a:proj-1/mod-1/req-1"],
    });
    const rows = flattenVisible(forest);
    const canonical = rows.find((n) => n.id === "a:proj-1/mod-1/flujo-3");
    expect(canonical?.label).toBe("Flujo de caja");
    const link = rows.find((n) => n.id === "l:req-1/flujo-3");
    expect(link?.label).toBe("Flujo de caja");
    expect(link?.artifactId).toBe("flujo-3");
  });
});
