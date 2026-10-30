// @vitest-environment jsdom
// Traceability view: sections from explicit links, opening in code,
// refresh on changes and late responses. Injected backend; no Tauri
// or network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TraceView, type TraceApi } from "./TraceView";
import { useRequirementsUi } from "../requirements/uiStore";
import { fnv1aHex } from "../code/model";
import type { ArtifactDto } from "../requirements/types";
import type { CodeLinkDto, SnapshotMetaDto } from "../code/types";
import type { StructureResult } from "../code/structure/structureTypes";
import { STRUCTURE_LIMITS } from "../code/structure/structureTypes";

afterEach(() => {
  cleanup();
  useRequirementsUi.getState().setCodeActiveFile(null);
  vi.restoreAllMocks();
});

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
      hash: fnv1aHex("current content"),
    },
    kind: "detected",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function snapshotMeta(overrides: Partial<SnapshotMetaDto> = {}): SnapshotMetaDto {
  return {
    id: "snap-1",
    projectId: "proj-1",
    name: "Base",
    createdAt: "2026-01-02",
    files: [],
    symbolCount: 2,
    relationCount: 0,
    ...overrides,
  };
}

function snapshotResult(): StructureResult {
  return {
    files: [],
    symbols: [
      {
        id: "s1",
        language: "ts",
        kind: "class",
        name: "Sale",
        rootId: "root-1",
        rel: "a.ts",
        range: { startLine: 1, startCol: 1, endLine: 10, endCol: 1 },
        members: [],
        membersTruncated: false,
        heuristic: null,
      },
      {
        id: "s9",
        language: "ts",
        kind: "function",
        name: "help",
        rootId: "root-1",
        rel: "b.ts",
        range: { startLine: 1, startCol: 1, endLine: 3, endCol: 1 },
        members: [],
        membersTruncated: false,
        heuristic: null,
      },
    ],
    relations: [],
    endpoints: [],
    calls: [],
    symbolsTruncated: false,
    relationsTruncated: false,
    endpointsTruncated: false,
    callsTruncated: false,
    limits: STRUCTURE_LIMITS,
  };
}

function api(overrides: Partial<TraceApi> = {}): TraceApi {
  return {
    listModuleArtifacts: vi.fn(async () => [
      artifact({}),
      artifact({ id: "req-2", title: "Reserve", kind: "requirement" }),
    ]),
    listProjectLinks: vi.fn(async () => ({ moduleLinks: [], artifactLinks: [link({})] })),
    listSnapshots: vi.fn(async () => [snapshotMeta({})]),
    getSnapshot: vi.fn(async (id: string) => ({ meta: snapshotMeta({ id }), result: snapshotResult() })),
    listRoots: vi.fn(async () => [
      { id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: "proj-1" },
    ]),
    readFileText: vi.fn(async () => "current content"),
    listModules: vi.fn(async () => [{ id: "mod-1", name: "Sales" }]),
    ...overrides,
  };
}

function renderTrace(props: { backend?: TraceApi; moduleId?: string } = {}) {
  const onOpenArtifact = vi.fn();
  render(
    <TraceView
      projectId="proj-1"
      moduleId={props.moduleId ?? "mod-1"}
      moduleName="Ventas"
      onOpenArtifact={onOpenArtifact}
      api={props.backend ?? api()}
    />,
  );
  return { onOpenArtifact };
}

describe("TraceView", () => {
  it("shows counts and sections from explicit links", async () => {
    renderTrace();
    expect(await screen.findByText(/2 artifacts/)).toBeDefined();
    expect(screen.getByText(/1 linked/)).toBeDefined();
    // req-1 linked with its symbol and computed freshness.
    const linked = within(screen.getByRole("region", { name: "Linked artifacts" }));
    expect(await linked.findByText("Confirm sale")).toBeDefined();
    expect(linked.getByText("Sale")).toBeDefined();
    await waitFor(() =>
      expect(linked.getByText(/matches the current file/)).toBeDefined(),
    );
    // req-2 unlinked, with honest guidance.
    const unlinked = within(screen.getByRole("region", { name: "Unlinked artifacts" }));
    expect(unlinked.getByText(/Reserve/)).toBeDefined();
    // s9 orphan (s1 is linked); the other module never shows here.
    const orphans = within(screen.getByRole("region", { name: "Unlinked code" }));
    expect(await orphans.findByText("help")).toBeDefined();
    expect(orphans.queryByText("Sale")).toBeNull();
  });

  it("opening publishes a code request and viewing opens the artifact", async () => {
    const { onOpenArtifact } = renderTrace();
    expect(await screen.findByText("Confirm sale")).toBeDefined();
    const linked = within(screen.getByRole("region", { name: "Linked artifacts" }));
    fireEvent.click(linked.getByRole("button", { name: "Open" }));
    expect(useRequirementsUi.getState().codeOpenRequest).toMatchObject({
      rootId: "root-1",
      rel: "a.ts",
    });
    fireEvent.click(linked.getByRole("button", { name: "View requirement" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(expect.objectContaining({ id: "req-1" }));
  });

  it("reloads when links change", async () => {
    const backend = api();
    renderTrace({ backend });
    expect(await screen.findByText(/2 artifacts/)).toBeDefined();
    expect(backend.listProjectLinks).toHaveBeenCalledTimes(1);
    useRequirementsUi.getState().bumpCodeLibrary();
    await waitFor(() => expect(backend.listProjectLinks).toHaveBeenCalledTimes(2));
  });

  it("an unreadable snapshot warns without breaking the view", async () => {
    const backend = api({
      getSnapshot: vi.fn(async () => {
        throw { kind: "io", message: "disk full" };
      }),
    });
    renderTrace({ backend });
    expect(await screen.findByText(/could not be read/)).toBeDefined();
    // Links still show normally.
    const linked = within(screen.getByRole("region", { name: "Linked artifacts" }));
    expect(await linked.findByText("Confirm sale")).toBeDefined();
  });

  it("a late response never overwrites the current module", async () => {
    let resolveFirst!: (value: ArtifactDto[]) => void;
    const first = new Promise<ArtifactDto[]>((resolve) => {
      resolveFirst = resolve;
    });
    const backend = api({
      listModuleArtifacts: vi.fn(async (_p: string, moduleId: string) =>
        moduleId === "mod-1" ? first : [artifact({ id: "req-9", title: "Other module" })],
      ),
      listProjectLinks: vi.fn(async () => ({ moduleLinks: [], artifactLinks: [] })),
      listSnapshots: vi.fn(async () => []),
    });
    const view = render(
      <TraceView projectId="proj-1" moduleId="mod-1" moduleName={null} api={backend} />,
    );
    view.rerender(<TraceView projectId="proj-1" moduleId="mod-2" moduleName={null} api={backend} />);
    expect(await screen.findByText(/Other module/)).toBeDefined();
    resolveFirst([artifact({ id: "req-old", title: "Old link" })]);
    await waitFor(() => expect(backend.listModuleArtifacts).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/Old link/)).toBeNull();
    expect(screen.getByText(/Other module/)).toBeDefined();
  });

  it("honest emptiness without artifacts or symbols", async () => {
    const backend = api({
      listModuleArtifacts: vi.fn(async () => []),
      listProjectLinks: vi.fn(async () => ({ moduleLinks: [], artifactLinks: [] })),
      listSnapshots: vi.fn(async () => []),
    });
    renderTrace({ backend });
    expect(await screen.findByText(/0 artifacts/)).toBeDefined();
    expect(screen.getByText(/has no artifacts and no symbols/)).toBeDefined();
  });
});
