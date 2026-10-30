import { describe, expect, it } from "vitest";
import { buildTraceModel, MAX_TRACE_SYMBOLS } from "./traceModel";
import type { ArtifactDto } from "../requirements/types";
import type { CodeLinkDto } from "../code/types";

function artifact(overrides: Partial<ArtifactDto> = {}): ArtifactDto {
  return {
    id: "req-1",
    projectId: "proj-1",
    moduleId: "mod-1",
    kind: "requirement",
    title: "Confirm sale",
    archived: false,
    ...overrides,
  };
}

function link(overrides: Partial<CodeLinkDto> = {}): CodeLinkDto {
  return {
    id: "link-1",
    scope: "artifact",
    ownerId: "req-1",
    rootId: "root-1",
    rootName: "frontend",
    rootMissing: false,
    rel: "a.ts",
    symbol: {
      id: "s1",
      name: "Sale",
      kind: "class",
      startLine: 1,
      startCol: 1,
      endLine: 10,
      endCol: 1,
      hash: "h",
    },
    kind: "detected",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function symbol(id: string, snapshotName = "Base") {
  return {
    id,
    name: id,
    kind: "class",
    rootId: "root-1",
    rel: "a.ts",
    snapshotId: "snap-1",
    snapshotName,
  };
}

const EMPTY = {
  moduleArtifacts: [] as ArtifactDto[],
  moduleId: "mod-1",
  projectModuleLinks: [] as CodeLinkDto[],
  projectArtifactLinks: [] as CodeLinkDto[],
  snapshotSymbols: [],
};

describe("buildTraceModel", () => {
  it("groups links per module artifact in stable order", () => {
    const model = buildTraceModel({
      ...EMPTY,
      moduleArtifacts: [artifact({ id: "req-1" }), artifact({ id: "req-2", title: null })],
      projectArtifactLinks: [
        link({ id: "link-b", ownerId: "req-2", symbol: { ...link({}).symbol!, id: "s2" } }),
        link({ id: "link-a", ownerId: "req-1" }),
      ],
    });
    expect(model.linked.map((row) => row.artifact.id)).toEqual(["req-1", "req-2"]);
    expect(model.linked[0].label).toBe("Confirm sale");
    expect(model.linked[0].links.map((l) => l.id)).toEqual(["link-a"]);
    // Without a title: the id, inventing no labels.
    expect(model.linked[1].label).toBe("req-2");
    expect(model.unlinkedArtifacts).toEqual([]);
    expect(model.counts).toMatchObject({ artifacts: 2, linkedArtifacts: 2, artifactLinks: 2 });
  });

  it("separates unlinked artifacts and other modules’ links", () => {
    const model = buildTraceModel({
      ...EMPTY,
      moduleArtifacts: [artifact({ id: "req-1" })],
      projectArtifactLinks: [link({ id: "link-x", ownerId: "req-other" })],
    });
    expect(model.linked).toEqual([]);
    expect(model.unlinkedArtifacts.map((a) => a.id)).toEqual(["req-1"]);
    expect(model.counts.artifactLinks).toBe(0);
  });

  it("filters the module manual links sorted by id", () => {
    const model = buildTraceModel({
      ...EMPTY,
      projectModuleLinks: [
        link({ id: "link-m2", scope: "module", ownerId: "mod-1", rel: "b", symbol: null, kind: "manual" }),
        link({ id: "link-m1", scope: "module", ownerId: "mod-1", rel: "a", symbol: null, kind: "manual" }),
        link({ id: "link-other", scope: "module", ownerId: "mod-9", rel: "z", symbol: null, kind: "manual" }),
      ],
    });
    expect(model.moduleLinks.map((l) => l.id)).toEqual(["link-m1", "link-m2"]);
    expect(model.counts.moduleLinks).toBe(2);
  });

  it("orphans: snapshot symbols with no artifact in the project", () => {
    const model = buildTraceModel({
      ...EMPTY,
      projectArtifactLinks: [link({})],
      snapshotSymbols: [symbol("s1"), symbol("s2"), symbol("s2", "Otra")],
    });
    // s1 linked; s2 exactly once even when spanning two snapshots.
    expect(model.orphanSymbols.map((s) => s.id)).toEqual(["s2"]);
    expect(model.orphanSymbols[0].snapshotName).toBe("Base");
    expect(model.orphansTruncated).toBe(false);
    expect(model.counts.orphanSymbols).toBe(1);
  });

  it("a symbol linked in another module is no global orphan", () => {
    const model = buildTraceModel({
      ...EMPTY,
      moduleArtifacts: [artifact({ id: "req-1" })],
      projectArtifactLinks: [link({ ownerId: "req-other" })],
      snapshotSymbols: [symbol("s1")],
    });
    expect(model.orphanSymbols).toEqual([]);
    // …but this module's artifact stays unlinked here.
    expect(model.unlinkedArtifacts.map((a) => a.id)).toEqual(["req-1"]);
  });

  it("truncates orphans at the cap with a warning", () => {
    const symbols = Array.from({ length: MAX_TRACE_SYMBOLS + 5 }, (_, i) =>
      symbol(`s${String(i).padStart(4, "0")}`),
    );
    const model = buildTraceModel({ ...EMPTY, snapshotSymbols: symbols });
    expect(model.orphanSymbols).toHaveLength(MAX_TRACE_SYMBOLS);
    expect(model.orphansTruncated).toBe(true);
    expect(model.counts.orphanSymbols).toBe(MAX_TRACE_SYMBOLS + 5);
  });

  it("total emptiness: honest zeros without rows", () => {
    const model = buildTraceModel(EMPTY);
    expect(model.linked).toEqual([]);
    expect(model.unlinkedArtifacts).toEqual([]);
    expect(model.moduleLinks).toEqual([]);
    expect(model.orphanSymbols).toEqual([]);
    expect(model.counts).toEqual({
      artifacts: 0,
      linkedArtifacts: 0,
      artifactLinks: 0,
      moduleLinks: 0,
      orphanSymbols: 0,
    });
  });
});
