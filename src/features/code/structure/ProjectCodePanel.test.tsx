// @vitest-environment jsdom
// Project panel in Structure: linking symbol→artifact with evidence,
// a link list with computed freshness and snapshots
// (save/list/verify/delete). Injected backend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectCodePanel, type ProjectCodeApi, type SelectedSymbolRef } from "./ProjectCodePanel";
import { fnv1aHex } from "../model";
import { STRUCTURE_LIMITS, type StructureResult } from "./structureTypes";
import type { ArtifactDto, ModuleDto } from "../../requirements/types";
import type { CodeLinkDto, SnapshotMetaDto } from "../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SYMBOL: SelectedSymbolRef = {
  id: "ts:root-1:a.ts:Venta",
  name: "Venta",
  kind: "class",
  rootId: "root-1",
  rel: "a.ts",
  range: { startLine: 1, startCol: 1, endLine: 10, endCol: 1 },
  hash: "evidencia1",
};

const RESULT: StructureResult = {
  files: [
    {
      rootId: "root-1",
      rel: "a.ts",
      hash: "evidencia1",
      bytes: 42,
      language: "ts",
      status: "ok",
      message: null,
    },
    {
      rootId: "root-1",
      rel: "roto.ts",
      hash: "",
      bytes: 0,
      language: null,
      status: "error",
      message: "could not be read",
    },
  ],
  symbols: [],
  relations: [],
  endpoints: [],
  calls: [],
  symbolsTruncated: false,
  relationsTruncated: false,
  endpointsTruncated: false,
  callsTruncated: false,
  limits: STRUCTURE_LIMITS,
};

function moduleLink(overrides: Partial<CodeLinkDto> = {}): CodeLinkDto {
  return {
    id: "link-m1",
    scope: "module",
    ownerId: "mod-1",
    rootId: "root-1",
    rootName: "frontend",
    rootMissing: false,
    rel: "src",
    symbol: null,
    kind: "manual",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function symbolLink(overrides: Partial<CodeLinkDto> = {}): CodeLinkDto {
  return {
    id: "link-a1",
    scope: "artifact",
    ownerId: "req-1",
    rootId: "root-1",
    rootName: "frontend",
    rootMissing: false,
    rel: "a.ts",
    symbol: {
      id: SYMBOL.id,
      name: "Venta",
      kind: "class",
      startLine: 1,
      startCol: 1,
      endLine: 10,
      endCol: 1,
      hash: fnv1aHex("current content"),
    },
    kind: "detected",
    createdAt: "2026-01-02",
    ...overrides,
  };
}

function snapshot(overrides: Partial<SnapshotMetaDto> = {}): SnapshotMetaDto {
  return {
    id: "snap-1",
    projectId: "proj-1",
    name: "Baseline analysis",
    createdAt: "2026-01-03",
    files: [{ rootId: "root-1", rootName: "frontend", rel: "a.ts", hash: "h", bytes: 42 }],
    symbolCount: 3,
    relationCount: 2,
    ...overrides,
  };
}

function artifacts(): ArtifactDto[] {
  return [
    {
      id: "req-1",
      projectId: "proj-1",
      moduleId: "mod-1",
      kind: "requirement",
      title: "Confirmar venta",
      archived: false,
    },
    {
      id: "flow-1",
      projectId: "proj-1",
      moduleId: "mod-1",
      kind: "flow",
      title: null,
      archived: false,
    },
  ];
}

function modules(): ModuleDto[] {
  return [{ id: "mod-1", projectId: "proj-1", name: "Ventas", archived: false }];
}

function api(overrides: Partial<ProjectCodeApi> = {}): ProjectCodeApi {
  return {
    listProjectLinks: vi.fn(async () => ({ moduleLinks: [], artifactLinks: [] })),
    addSymbolLink: vi.fn(async () => symbolLink({})),
    removeCodeLink: vi.fn(async (id) => id),
    readFileText: vi.fn(async () => "current content"),
    listModules: vi.fn(async () => modules()),
    listModuleArtifacts: vi.fn(async () => artifacts()),
    saveSnapshot: vi.fn(async (_p, name) => snapshot({ name })),
    listSnapshots: vi.fn(async () => []),
    deleteSnapshot: vi.fn(async (id) => id),
    verifySnapshot: vi.fn(async () => ({ files: [], stale: false })),
    ...overrides,
  };
}

function renderPanel(props: {
  projectId?: string | null;
  moduleId?: string | null;
  symbol?: SelectedSymbolRef | null;
  result?: StructureResult | null;
  backend?: ProjectCodeApi;
}) {
  const backend = props.backend ?? api();
  const onOpenFile = vi.fn();
  render(
    <ProjectCodePanel
      projectId={props.projectId === undefined ? "proj-1" : props.projectId}
      moduleId={props.moduleId === undefined ? "mod-1" : props.moduleId}
      selectedSymbol={props.symbol === undefined ? SYMBOL : props.symbol}
      result={props.result === undefined ? RESULT : props.result}
      rootNames={{ "root-1": "frontend" }}
      onOpenFile={onOpenFile}
      api={backend}
    />,
  );
  return { backend, onOpenFile };
}

function linksRegion() {
  return within(screen.getByRole("region", { name: "Project links" }));
}

function snapsRegion() {
  return within(screen.getByRole("region", { name: "Analysis snapshots" }));
}

describe("ProjectCodePanel", () => {
  it("links the symbol with range and origin hash", async () => {
    const { backend } = renderPanel({});
    const region = within(screen.getByRole("region", { name: "Link symbol" }));
    // The select fills with the module artifacts.
    const select = (await region.findByLabelText("Artifact")) as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    fireEvent.change(select, { target: { value: "flow-1" } });
    fireEvent.click(region.getByRole("button", { name: "Link" }));
    await waitFor(() =>
      expect(backend.addSymbolLink).toHaveBeenCalledWith("flow-1", "root-1", "a.ts", {
        id: SYMBOL.id,
        name: "Venta",
        kind: "class",
        startLine: 1,
        startCol: 1,
        endLine: 10,
        endCol: 1,
        hash: "evidencia1",
      }),
    );
    expect(await region.findByText(/linked with origin evidence/)).toBeDefined();
  });

  it("a duplicate link shows as an error", async () => {
    const backend = api({
      addSymbolLink: vi.fn(async () => {
        throw { kind: "code_link_duplicate", message: "That link already exists" };
      }),
    });
    renderPanel({ backend });
    const region = within(screen.getByRole("region", { name: "Link symbol" }));
    await region.findByLabelText("Artifact");
    fireEvent.click(region.getByRole("button", { name: "Link" }));
    expect(await region.findByText("That link already exists")).toBeDefined();
  });

  it("without a module requests no artifacts and allows no linking", () => {
    const { backend } = renderPanel({ moduleId: null });
    const region = within(screen.getByRole("region", { name: "Link symbol" }));
    expect(region.getByText(/Select a project and a module/)).toBeDefined();
    expect(backend.listModuleArtifacts).not.toHaveBeenCalled();
  });

  it("lists links with labels and computed freshness", async () => {
    const backend = api({
      listProjectLinks: vi.fn(async () => ({
        moduleLinks: [moduleLink({})],
        artifactLinks: [
          symbolLink({}),
          symbolLink({
            id: "link-a2",
            symbol: { ...symbolLink({}).symbol!, hash: "other-hash" },
          }),
        ],
      })),
    });
    renderPanel({ backend });
    const region = linksRegion();
    expect(await region.findByText(/module Ventas/)).toBeDefined();
    // Two links of the same artifact: one fresh and one changed.
    expect(region.getAllByText(/requirement "Confirmar venta"/).length).toBe(2);
    // Fresh: the hash matches the current file; the other one changed.
    await waitFor(() =>
      expect(region.getByText(/matches the current file/)).toBeDefined(),
    );
    expect(region.getByText(/the file changed since the link/)).toBeDefined();
    expect(backend.readFileText).toHaveBeenCalledWith("root-1", "a.ts");
  });

  it("unlinking asks for confirmation and refreshes the list", async () => {
    let links = [moduleLink({})];
    const backend = api({
      listProjectLinks: vi.fn(async () => ({ moduleLinks: links, artifactLinks: [] })),
      removeCodeLink: vi.fn(async (id) => {
        links = links.filter((link) => link.id !== id);
        return id;
      }),
    });
    renderPanel({ backend });
    const region = linksRegion();
    expect(await region.findByText(/module Ventas/)).toBeDefined();
    fireEvent.click(region.getByRole("button", { name: "Unlink" }));
    expect(backend.removeCodeLink).not.toHaveBeenCalled();
    fireEvent.click(region.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(backend.removeCodeLink).toHaveBeenCalledWith("link-m1"));
    await waitFor(() => expect(region.queryByText(/module Ventas/)).toBeNull());
  });

  it("opening a link delegates to the editor without deleting anything", async () => {
    const { backend, onOpenFile } = renderPanel({
      backend: api({
        listProjectLinks: vi.fn(async () => ({ moduleLinks: [moduleLink({})], artifactLinks: [] })),
      }),
    });
    const region = linksRegion();
    expect(await region.findByText(/module Ventas/)).toBeDefined();
    fireEvent.click(region.getByRole("button", { name: "Open" }));
    expect(onOpenFile).toHaveBeenCalledWith("root-1", "src");
    expect(backend.removeCodeLink).not.toHaveBeenCalled();
  });

  it("saves the snapshot without unreadable files and with a default name", async () => {
    const { backend } = renderPanel({ backend: api({ listSnapshots: vi.fn(async () => []) }) });
    const region = snapsRegion();
    expect(await region.findByText(/No saved snapshots/)).toBeDefined();
    fireEvent.click(region.getByRole("button", { name: "Save snapshot" }));
    await waitFor(() => expect(backend.saveSnapshot).toHaveBeenCalledTimes(1));
    const [, name, payload] = (backend.saveSnapshot as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      StructureResult,
    ];
    expect(name).toMatch(/^Analysis \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(payload.files.map((file) => file.rel)).toEqual(["a.ts"]);
  });

  it("verifies a snapshot file by file", async () => {
    const backend = api({
      listSnapshots: vi.fn(async () => [snapshot({})]),
      verifySnapshot: vi.fn(async () => ({
        files: [
          { rootId: "root-1", rel: "a.ts", status: "stale" as const, message: null },
          { rootId: "root-1", rel: "falta.ts", status: "missing" as const, message: null },
        ],
        stale: true,
      })),
    });
    renderPanel({ backend });
    const region = snapsRegion();
    expect(await region.findByText("Baseline analysis")).toBeDefined();
    fireEvent.click(region.getByRole("button", { name: "Verify" }));
    expect(await region.findByText(/Stale/)).toBeDefined();
    const report = within(region.getByRole("list", { name: "Verification of Baseline analysis" }));
    expect(report.getByText("changed")).toBeDefined();
    expect(report.getByText("missing")).toBeDefined();
  });

  it("deleting a snapshot asks for confirmation", async () => {
    let snaps = [snapshot({})];
    const backend = api({
      listSnapshots: vi.fn(async () => snaps),
      deleteSnapshot: vi.fn(async (id) => {
        snaps = snaps.filter((snap) => snap.id !== id);
        return id;
      }),
    });
    renderPanel({ backend });
    const region = snapsRegion();
    expect(await region.findByText("Baseline analysis")).toBeDefined();
    fireEvent.click(region.getByRole("button", { name: "Delete" }));
    expect(backend.deleteSnapshot).not.toHaveBeenCalled();
    fireEvent.click(region.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(backend.deleteSnapshot).toHaveBeenCalledWith("snap-1"));
    await waitFor(() => expect(region.queryByText("Baseline analysis")).toBeNull());
  });

  it("without a project calls no backend and guides the user", () => {
    const { backend } = renderPanel({ projectId: null, moduleId: null });
    expect(screen.getByRole("region", { name: "Link symbol" })).toBeDefined();
    expect(backend.listProjectLinks).not.toHaveBeenCalled();
    expect(backend.listSnapshots).not.toHaveBeenCalled();
    expect(backend.listModuleArtifacts).not.toHaveBeenCalled();
  });

  it("a late response does not overwrite the current project links", async () => {
    let resolveFirst!: (value: { moduleLinks: CodeLinkDto[]; artifactLinks: CodeLinkDto[] }) => void;
    const first = new Promise<{ moduleLinks: CodeLinkDto[]; artifactLinks: CodeLinkDto[] }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    const backend = api({
      listProjectLinks: vi.fn(async (projectId: string) =>
        projectId === "proj-1" ? first : { moduleLinks: [], artifactLinks: [] },
      ),
    });
    const view = render(
      <ProjectCodePanel
        projectId="proj-1"
        moduleId="mod-1"
        selectedSymbol={null}
        result={null}
        rootNames={{}}
        onOpenFile={() => {}}
        api={backend}
      />,
    );
    view.rerender(
      <ProjectCodePanel
        projectId="proj-2"
        moduleId={null}
        selectedSymbol={null}
        result={null}
        rootNames={{}}
        onOpenFile={() => {}}
        api={backend}
      />,
    );
    expect(await linksRegion().findByText(/No links yet/)).toBeDefined();
    resolveFirst({ moduleLinks: [moduleLink({ rel: "old" })], artifactLinks: [] });
    await waitFor(() => expect(backend.listProjectLinks).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(linksRegion().queryByText(/\/old/)).toBeNull();
  });
});
