// @vitest-environment jsdom
// ProjectMapView: automatic per-root diagrams, eye toggles, honest
// partial states, plus nested project scopes (one section per
// detected project, sibling exclusion, batches, cancel). The center
// shows a compact breadcrumb only: scope and visibility are driven
// from the outside, like the explorer tree drives them. All IO
// injected; no Tauri, no network.
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ProjectMapView,
  type ProjectMapDeps,
  type ReanalyzeRequest,
} from "./ProjectMapView";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { useRequirementsUi, type ArchScope } from "../../requirements/uiStore";
import { clearDiscoveryCache } from "../detectProjects";
import type {
  CodeGenerationDto,
  CodeListingDto,
  CodeProposalFileDto,
  CodeRootDto,
  CodeTab,
} from "../types";

afterEach(() => cleanup());

/** The footer status bar: scope chip, coverage, Analyze more, unsaved. */
function statusBar(): HTMLElement {
  return screen.getByLabelText("Analysis status");
}

/** Opens the toolbar's Analysis details panel (notes, retries, hidden). */
async function openDetails() {
  fireEvent.click(screen.getByRole("button", { name: /^Details/ }));
  return within(await screen.findByRole("dialog", { name: "Analysis details" }));
}

beforeEach(() => {
  localStorage.clear();
  useRequirementsUi.setState({ archInspectorWidth: null, archInspectorCollapsed: false });
});

const CTRL = `import { SalesService } from "./sales.service";
export class SalesController {
  constructor(private readonly svc: SalesService) {}
}`;
const SVC = `export class SalesService { all() { return []; } }`;
const APP = `export class AppComponent { title = "shop"; }`;
const CTRL_WITH_LIST = `import { SalesService } from "./sales.service";
export class SalesController {
  constructor(private readonly svc: SalesService) {}
  list() { return this.svc.all(); }
}`;
const CTRL_PREPENDED = `export class Above {}
import { SalesService } from "./sales.service";
export class SalesController {
  constructor(private readonly svc: SalesService) {}
  list() { return this.svc.all(); }
}`;

function root(overrides: Partial<CodeRootDto> & { id: string }): CodeRootDto {
  return {
    path: `/repo/${overrides.id}`,
    name: overrides.id,
    missing: false,
    projectId: null,
    ...overrides,
  };
}

const ROOTS = [
  root({ id: "be", name: "backend", projectId: "p1" }),
  root({ id: "fe", name: "frontend", projectId: "p1" }),
  root({ id: "other", name: "unrelated", projectId: "p2" }),
  root({ id: "gone", name: "deleted", projectId: "p1", missing: true }),
];

function listing(
  entries: Array<{ name: string; rel: string; kind: "file" | "dir" | "other" }>,
  truncated = false,
): CodeListingDto {
  return {
    entries: entries.map((e) => ({ ...e, size: e.kind === "file" ? 10 : null })),
    truncated,
  };
}

const TREE: Record<string, CodeListingDto> = {
  "be::": listing([
    { name: "sales.controller.ts", rel: "src/sales.controller.ts", kind: "file" },
    { name: "sales.service.ts", rel: "src/sales.service.ts", kind: "file" },
  ]),
  "fe::": listing([{ name: "app.component.ts", rel: "app.component.ts", kind: "file" }]),
};

const CONTENTS: Record<string, string> = {
  "be::src/sales.controller.ts": CTRL,
  "be::src/sales.service.ts": SVC,
  "fe::app.component.ts": APP,
};

function makeDeps(overrides: Partial<ProjectMapDeps> = {}): ProjectMapDeps {
  return {
    listDir: async (rootId, rel) => TREE[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
    readFile: async (rootId, rel) => {
      const text = CONTENTS[`${rootId}::${rel}`];
      if (text === undefined) throw { kind: "code_not_found", message: "missing" };
      return { text, fingerprint: "h", size: text.length };
    },
    analyzeTs: (files) => Promise.resolve(analyzeTsFiles(files)),
    ...overrides,
  };
}

function tab(overrides: Partial<CodeTab> & { rootId: string; rel: string }): CodeTab {
  return {
    rootName: overrides.rootId,
    name: overrides.rel.split("/").pop() ?? overrides.rel,
    content: null,
    error: null,
    loading: false,
    savedText: null,
    dirty: false,
    saving: false,
    saveError: null,
    language: "typescript",
    ...overrides,
  };
}

function proposalFile(
  rel: string,
  content: string,
  operation = "modify",
  rootId = "be",
): CodeProposalFileDto {
  return {
    pos: 0,
    rootId,
    rel,
    operation,
    state: "pending",
    decidedAt: null,
    content,
    expectedFingerprint: null,
  };
}

function renderView(options: {
  roots?: CodeRootDto[];
  tabs?: CodeTab[];
  deps?: ProjectMapDeps;
  hidden?: Record<string, boolean>;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  showTests?: boolean;
  showConfig?: boolean;
  edgeOpts?: { incoming: boolean; outgoing: boolean; depth: 1 | 2 };
  onToggleRoot?: (rootId: string) => void;
  scope?: ArchScope;
  onScopeChange?: (scope: ArchScope) => void;
  hiddenProjects?: Record<string, boolean>;
  onShowAllProjects?: () => void;
  groupBy?: "symbols" | "files";
  proposalFiles?: CodeProposalFileDto[] | null;
  proposalGeneration?: CodeGenerationDto | null;
  onOpenProposal?: () => void;
  onCloseProposal?: () => void;
  reanalyzeRequest?: ReanalyzeRequest | null;
  onChainFiles?: (files: Array<{ rootId: string; rel: string }>) => void;
  footerActions?: ReactNode;
  footerDrawer?: ReactNode;
}) {
  const api: {
    setScope: (scope: ArchScope) => void;
    setHiddenProjects: (hidden: Record<string, boolean>) => void;
    setHidden: (hidden: Record<string, boolean>) => void;
    setProposalFiles: (files: CodeProposalFileDto[] | null) => void;
    setReanalyzeRequest: (request: ReanalyzeRequest | null) => void;
  } = { setScope: () => {}, setHiddenProjects: () => {}, setHidden: () => {}, setProposalFiles: () => {}, setReanalyzeRequest: () => {} };
  const onToggleRoot = options.onToggleRoot ?? (() => {});
  function Harness() {
    const [hidden, setHidden] = useState<Record<string, boolean>>(options.hidden ?? {});
    const [scope, setScope] = useState<ArchScope>(options.scope ?? { kind: "all" });
    const [hiddenProjects, setHiddenProjects] = useState<Record<string, boolean>>(
      options.hiddenProjects ?? {},
    );
    const [proposalFiles, setProposalFiles] = useState<CodeProposalFileDto[] | null>(
      options.proposalFiles ?? null,
    );
    const [reanalyzeRequest, setReanalyzeRequest] = useState<ReanalyzeRequest | null>(
      options.reanalyzeRequest ?? null,
    );
    api.setScope = setScope;
    api.setHiddenProjects = setHiddenProjects;
    api.setHidden = setHidden;
    api.setProposalFiles = setProposalFiles;
    api.setReanalyzeRequest = setReanalyzeRequest;
    return (
      <ProjectMapView
        projectId="p1"
        roots={options.roots ?? ROOTS}
        hidden={options.hidden ?? hidden}
        onToggleRoot={(id) => {
          onToggleRoot(id);
          setHidden((prev) => ({ ...prev, [id]: !prev[id] }));
        }}
        tabs={options.tabs ?? []}
        deps={options.deps ?? makeDeps()}
        groupBy={options.groupBy ?? "files"}
        zoom={options.zoom}
        onZoomChange={options.onZoomChange}
        showTests={options.showTests}
        showConfig={options.showConfig}
        edgeOpts={options.edgeOpts}
        scope={options.scope ?? scope}
        onScopeChange={(next) => {
          options.onScopeChange?.(next);
          setScope(next);
        }}
        hiddenProjects={options.hiddenProjects ?? hiddenProjects}
        onShowAllProjects={() => {
          options.onShowAllProjects?.();
          setHiddenProjects({});
        }}
        proposalFiles={options.proposalFiles ?? proposalFiles}
        proposalGeneration={options.proposalGeneration}
        reanalyzeRequest={options.reanalyzeRequest ?? reanalyzeRequest}
        onOpenProposal={options.onOpenProposal}
        onCloseProposal={options.onCloseProposal}
        onChainFiles={options.onChainFiles}
        footerActions={options.footerActions}
        footerDrawer={options.footerDrawer}
      />
    );
  }
  const utils = render(<Harness />);
  return {
    container: utils.container,
    setScope: (scope: ArchScope) => act(() => api.setScope(scope)),
    setHiddenProjects: (hidden: Record<string, boolean>) => act(() => api.setHiddenProjects(hidden)),
    setHidden: (hidden: Record<string, boolean>) => act(() => api.setHidden(hidden)),
    setProposalFiles: (files: CodeProposalFileDto[] | null) => act(() => api.setProposalFiles(files)),
    setReanalyzeRequest: (request: ReanalyzeRequest | null) => act(() => api.setReanalyzeRequest(request)),
  };
}

describe("ProjectMapView", () => {
  it("scales every diagram with the shared board zoom", async () => {
    const { container } = renderView({ zoom: 1.5 });
    expect(await screen.findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    const zoomed = Array.from(container.querySelectorAll(".archmap-zoom"));
    expect(zoomed.length).toBeGreaterThan(0);
    for (const node of zoomed) {
      expect(node.getAttribute("style") ?? "").toContain("zoom: 1.5");
    }
  });

  it("renders one automatic diagram per associated root", async () => {
    renderView({});
    expect(await screen.findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    // Joint view: coverage in the status bar, no scope chip.
    expect(statusBar().textContent).toMatch(/3\/3 files analyzed/);
    expect(screen.queryByRole("button", { name: /^Scoped to/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Services (1 file)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "UI Components (1 file)" })).toBeTruthy();
    expect(screen.getByLabelText("Diagram of backend")).toBeTruthy();
    expect(screen.getByLabelText("Diagram of frontend")).toBeTruthy();
    expect(screen.queryByLabelText("Diagram of unrelated")).toBeNull();
    expect(screen.queryByLabelText("Diagram of deleted")).toBeNull();
  });

  it("hides a root and restores it from Details without re-analyzing", async () => {
    const analyzeTs = vi.fn((files: Parameters<ProjectMapDeps["analyzeTs"]>[0]) =>
      Promise.resolve(analyzeTsFiles(files)),
    );
    const { setHidden } = renderView({ deps: makeDeps({ analyzeTs }) });
    expect(await screen.findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    await waitFor(() => expect(analyzeTs).toHaveBeenCalledTimes(2));
    // The tree eye hides a root (driven from outside the view).
    setHidden({ be: true });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Controllers (1 file)" })).toBeNull());
    expect(screen.getByRole("heading", { name: "UI Components (1 file)" })).toBeTruthy();
    const details = await openDetails();
    expect(details.getByText("backend")).toBeTruthy();
    fireEvent.click(details.getByRole("button", { name: "Show" }));
    expect(await screen.findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    // The cached map came back: no new analysis.
    expect(analyzeTs).toHaveBeenCalledTimes(2);
  });

  it("guides when the project has no folders", () => {
    renderView({ roots: [] });
    expect(screen.getByText(/No folders associated/)).toBeTruthy();
  });

  it("continues past unreadable files and reports them", async () => {
    const deps = makeDeps({
      readFile: async (rootId, rel) => {
        if (rel.endsWith("sales.service.ts")) throw { kind: "code_nope", message: "denied" };
        const text = CONTENTS[`${rootId}::${rel}`] ?? "";
        return { text, fingerprint: "h", size: text.length };
      },
    });
    renderView({ deps });
    const section = await screen.findByLabelText("Diagram of backend");
    expect(await within(section).findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    expect(statusBar().textContent).toMatch(/1 failed/);
    const details = await openDetails();
    expect(details.getByText(/Could not read src\/sales\.service\.ts: denied/)).toBeTruthy();
  });

  it("reports analysis errors with a working retry", async () => {
    let calls = 0;
    const deps = makeDeps({
      analyzeTs: (files) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("worker exploded"));
        return Promise.resolve(analyzeTsFiles(files));
      },
    });
    renderView({ deps });
    const section = await screen.findByLabelText("Diagram of backend");
    expect(await within(section).findByText(/Analysis failed/)).toBeTruthy();
    // The reason lives in Details; the section keeps a direct Retry.
    const details = await openDetails();
    expect(details.getByText(/worker exploded/)).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Retry" }));
    expect(await within(section).findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
  });

  it("inspects a function in the shared inspector with relations and evidence", async () => {
    renderView({});
    const section = await screen.findByLabelText("Diagram of backend");
    fireEvent.click(
      await within(section).findByRole("button", { name: "src/sales.service.ts, 1 symbols" }),
    );
    // A single inspector serves every board.
    const inspector = screen.getByRole("complementary", { name: "Board inspector" });
    fireEvent.click(within(inspector).getByRole("button", { name: /class SalesService/ }));
    const detail = within(within(inspector).getByLabelText("Symbol SalesService"));
    expect(detail.getByText(/Lines 1–1/)).toBeTruthy();
    expect(detail.getByText(/references/)).toBeTruthy();
    expect(detail.getByText(/resolved/)).toBeTruthy();
    fireEvent.click(detail.getByRole("button", { name: /class SalesController/ }));
    expect(within(inspector).getByLabelText("Symbol SalesController")).toBeTruthy();
  });

  it("draws edges only around the selection", async () => {
    const { container } = renderView({});
    const section = await screen.findByLabelText("Diagram of backend");
    expect(container.querySelectorAll(".arch-edge")).toHaveLength(0);
    fireEvent.click(
      await within(section).findByRole("button", { name: "src/sales.service.ts, 1 symbols" }),
    );
    await waitFor(() =>
      expect(
        within(section).getByLabelText("Architecture board").querySelectorAll(".arch-edge"),
      ).not.toHaveLength(0),
    );
  });

  it("filters edges by direction from the outside", async () => {
    renderView({ edgeOpts: { incoming: false, outgoing: false, depth: 1 } });
    const section = await screen.findByLabelText("Diagram of backend");
    fireEvent.click(
      await within(section).findByRole("button", { name: "src/sales.service.ts, 1 symbols" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Board inspector" })).toBeTruthy(),
    );
    expect(
      within(section).getByLabelText("Architecture board").querySelectorAll(".arch-edge"),
    ).toHaveLength(0);
  });

  it("lists members one per row with an honest note", async () => {
    renderView({});
    const section = await screen.findByLabelText("Diagram of backend");
    fireEvent.click(
      await within(section).findByRole("button", { name: "src/sales.service.ts, 1 symbols" }),
    );
    const inspector = screen.getByRole("complementary", { name: "Board inspector" });
    fireEvent.click(within(inspector).getByRole("button", { name: /class SalesService/ }));
    const detail = within(within(inspector).getByLabelText("Symbol SalesService"));
    expect(detail.getByText("all()")).toBeTruthy();
    expect(detail.getByText(/no own ranges/)).toBeTruthy();
    expect(detail.queryByRole("button", { name: "Open in code" })).toBeNull();
  });

  it("warns about drafts over analyzed files", async () => {
    renderView({
      tabs: [
        tab({ rootId: "be", rel: "src/sales.service.ts", dirty: true }),
        tab({ rootId: "be", rel: "unrelated.ts", dirty: true }),
      ],
    });
    expect(await screen.findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    // The status bar counts drafts and opens their note in Details.
    fireEvent.click(within(statusBar()).getByRole("button", { name: "1 unsaved" }));
    const details = within(await screen.findByRole("dialog", { name: "Analysis details" }));
    const note = details.getByText(/unsaved changes:/);
    expect(note.textContent).toMatch(/1 analyzed file/);
    expect(note.textContent).toMatch(/sales\.service\.ts/);
    expect(note.textContent).not.toMatch(/unrelated/);
  });

  it("collapses and resizes the shared inspector", async () => {
    renderView({});
    expect(await screen.findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    const inspector = screen.getByRole("complementary", { name: "Board inspector" });
    const separator = within(inspector).getByRole("separator", { name: "Inspector width" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(useRequirementsUi.getState().archInspectorWidth).toBe(320);
    fireEvent.mouseDown(separator, { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 460 });
    fireEvent.mouseUp(window);
    expect(useRequirementsUi.getState().archInspectorWidth).toBe(360);
    fireEvent.click(screen.getByRole("button", { name: "Hide inspector" }));
    expect(screen.queryByRole("complementary", { name: "Board inspector" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show inspector" }));
    expect(screen.getByRole("complementary", { name: "Board inspector" })).toBeTruthy();
  });

  it("never hijacks wheel scroll outside the board", async () => {
    const onZoomChange = vi.fn();
    renderView({ onZoomChange });
    await screen.findByRole("heading", { name: "Controllers (1 file)" });
    const inspector = screen.getByRole("complementary", { name: "Board inspector" });
    fireEvent.wheel(inspector, { deltaY: -100 });
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it("enters Flow mode from a card and leaves it", async () => {
    renderView({ groupBy: "symbols" });
    fireEvent.click(await screen.findByRole("button", { name: "Show flow of SalesController" }));
    expect(await screen.findByRole("button", { name: /^Leave flow/ })).toBeTruthy();
    expect(screen.getByText(/Flow: SalesController/)).toBeTruthy();
    expect(screen.queryByLabelText("Architecture board")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Leave flow/ }));
    expect(await screen.findByLabelText("Diagram of backend")).toBeTruthy();
  });

  it("shows proposal marks in Flow mode and removes them with the proposal", async () => {
    const { container, setProposalFiles } = renderView({ groupBy: "symbols" });
    fireEvent.click(await screen.findByRole("button", { name: "Show flow of SalesController" }));
    expect(await screen.findByRole("button", { name: /^Leave flow/ })).toBeTruthy();
    expect(container.querySelector(".archboard-card.proposed")).toBeNull();
    setProposalFiles([proposalFile("src/sales.controller.ts", CTRL_WITH_LIST)]);
    expect(container.querySelector(".archboard-card.proposed")).not.toBeNull();
    setProposalFiles(null);
    expect(container.querySelector(".archboard-card.proposed")).toBeNull();
  });

  it("builds the proposal overlay without reading or analyzing again", async () => {
    const readFile = vi.fn(async (rootId: string, rel: string) => {
      const text = CONTENTS[`${rootId}::${rel}`];
      if (text === undefined) throw { kind: "code_not_found", message: "missing" };
      return { text, fingerprint: "h", size: text.length };
    });
    const analyzeTs = vi.fn((files) => Promise.resolve(analyzeTsFiles(files)));
    const { container, setProposalFiles } = renderView({
      groupBy: "symbols",
      deps: makeDeps({ readFile, analyzeTs }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Show flow of SalesController" }));
    expect(await screen.findByRole("button", { name: /^Leave flow/ })).toBeTruthy();
    readFile.mockClear();
    analyzeTs.mockClear();
    setProposalFiles([proposalFile("src/sales.controller.ts", CTRL_WITH_LIST)]);
    expect(container.querySelector(".archboard-card.proposed")).not.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
    expect(analyzeTs).not.toHaveBeenCalled();
  });

  it("keeps the flow start when the proposal shifts symbol ids", async () => {
    const { container, setProposalFiles } = renderView({ groupBy: "symbols" });
    fireEvent.click(await screen.findByRole("button", { name: "Show flow of SalesController" }));
    expect(await screen.findByRole("button", { name: /^Leave flow/ })).toBeTruthy();
    setProposalFiles([proposalFile("src/sales.controller.ts", CTRL_PREPENDED)]);
    expect(screen.getByText(/Flow: SalesController/)).toBeTruthy();
    expect(container.querySelector(".archboard-card.proposed")).not.toBeNull();
    const board = screen.getByLabelText("Flow board");
    expect(within(board).getByTitle(/^Method: list/)).toBeTruthy();
  });

  it("starts Flow mode at the first proposed class without opening it", async () => {
    const { setProposalFiles } = renderView({ groupBy: "symbols" });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    setProposalFiles([proposalFile("src/report.ts", `export class Report {}`, "create")]);
    expect(await screen.findByRole("button", { name: /^Leave flow/ })).toBeTruthy();
    expect(screen.getByText(/Flow: Report/)).toBeTruthy();
  });
});

describe("proposal on the X-ray", () => {
  it("starts at the frontmost change, not the first file", async () => {
    const { setProposalFiles } = renderView({ groupBy: "symbols" });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    setProposalFiles([
      proposalFile("src/report.service.ts", `export class ReportService {}`, "create"),
      proposalFile("src/report.controller.ts", `export class ReportController {}`, "create"),
    ]);
    expect(await screen.findByText(/Flow: ReportController/)).toBeTruthy();
  });

  it("moves to the change when the open chain does not contain it", async () => {
    const { setProposalFiles } = renderView({ groupBy: "symbols" });
    fireEvent.click(await screen.findByRole("button", { name: "Show flow of SalesController" }));
    await screen.findByRole("button", { name: /^Leave flow/ });
    setProposalFiles([proposalFile("src/report.ts", `export class Report {}`, "create")]);
    expect(await screen.findByText(/Flow: Report/)).toBeTruthy();
  });

  it("lists changes that are off the drawn chain", async () => {
    const { setProposalFiles } = renderView({ groupBy: "symbols" });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    setProposalFiles([
      proposalFile("src/report.controller.ts", `export class ReportController {}`, "create"),
      proposalFile("src/other.service.ts", `export class OtherService {}`, "create"),
    ]);
    const list = await screen.findByLabelText("Also in this proposal");
    expect(within(list).getByText("OtherService")).toBeTruthy();
  });

  it("offers the way back to the proposal only while one is open", async () => {
    const onOpenProposal = vi.fn();
    const onCloseProposal = vi.fn();
    const { setProposalFiles } = renderView({ groupBy: "symbols", onOpenProposal, onCloseProposal });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    expect(screen.queryByRole("button", { name: "Back to proposal" })).toBeNull();
    setProposalFiles([proposalFile("src/report.ts", `export class Report {}`, "create")]);
    fireEvent.click(await screen.findByRole("button", { name: "Back to proposal" }));
    expect(onOpenProposal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close proposal" }));
    expect(onCloseProposal).toHaveBeenCalledTimes(1);
  });

  it("offers Ask Muse to adjust from the inspector", async () => {
    const onOpenProposal = vi.fn();
    const { setProposalFiles } = renderView({
      groupBy: "symbols",
      onOpenProposal,
      proposalGeneration: {
        id: "gen-1",
        model: "muse-spark-1.3",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        explanation: "",
        assumptions: [],
        questions: [],
        scope: [],
        files: [],
        stale: false,
        staleReason: null,
      } as unknown as CodeGenerationDto,
    });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    setProposalFiles([proposalFile("src/report.ts", `export class Report {}`, "create")]);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Muse to adjust" }));
    expect(onOpenProposal).toHaveBeenCalledTimes(1);
  });

  it("offers the open chain as the context for Muse", async () => {
    const onChainFiles = vi.fn();
    renderView({ groupBy: "symbols", onChainFiles });
    fireEvent.click(await screen.findByRole("button", { name: "Show flow of SalesController" }));
    await waitFor(() =>
      expect(onChainFiles).toHaveBeenLastCalledWith([
        { rootId: "be", rel: "src/sales.controller.ts" },
      ]),
    );
  });

  it("stays on the chain after every file is accepted, now as real code", async () => {
    let created = false;
    const report = `export class Report { run() {} }`;
    const deps = makeDeps({
      listDir: async (rootId, rel) => {
        const base = TREE[`${rootId}::${rel}`] ?? { entries: [], truncated: false };
        if (rootId !== "be" || !created) return base;
        return {
          ...base,
          entries: [
            ...base.entries,
            { name: "report.ts", rel: "src/report.ts", kind: "file", size: 10 },
          ],
        };
      },
      readFile: async (rootId, rel) => {
        const text = rel === "src/report.ts" ? report : CONTENTS[`${rootId}::${rel}`];
        if (text === undefined) throw { kind: "code_not_found", message: "missing" };
        return { text, fingerprint: "h", size: text.length };
      },
    });
    const { container, setProposalFiles, setReanalyzeRequest } = renderView({
      groupBy: "symbols",
      deps,
    });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    const file = proposalFile("src/report.ts", report, "create");
    setProposalFiles([file]);
    expect(await screen.findByText(/Flow: Report/)).toBeTruthy();
    expect(container.querySelector(".archboard-card.proposed")).not.toBeNull();
    created = true;
    setProposalFiles([{ ...file, state: "accepted" }]);
    setReanalyzeRequest({ files: [{ rootId: "be", rel: "src/report.ts" }], nonce: 1 });
    await waitFor(() => expect(screen.getByTitle(/^Method: run/)).toBeTruthy());
    expect(screen.getByText(/Flow: Report/)).toBeTruthy();
    expect(container.querySelector(".archboard-card.proposed")).toBeNull();
  });

  it("re-reads one file when re-analysis is requested", async () => {
    let ctrl = CTRL;
    const deps = makeDeps({
      readFile: async (rootId: string, rel: string) => {
        const text = rel.endsWith("sales.controller.ts") ? ctrl : CONTENTS[`${rootId}::${rel}`];
        if (text === undefined) throw { kind: "code_not_found", message: "missing" };
        return { text, fingerprint: "h", size: text.length };
      },
    });
    const { setReanalyzeRequest } = renderView({ groupBy: "symbols", deps });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    expect(screen.queryByTitle(/^Method: list/)).toBeNull();
    ctrl = CTRL_WITH_LIST;
    setReanalyzeRequest({ files: [{ rootId: "be", rel: "src/sales.controller.ts" }], nonce: 1 });
    expect(await screen.findByTitle(/^Method: list/)).toBeTruthy();
  });
});

const FE_CTRL = `export class FeController {
  constructor(private readonly svc: FeService) {}
}`;
const FE_SVC = `export class FeService { all() { return []; } }`;
const BE_CTRL = `export class BeController {
  constructor(private readonly svc: BeService) {}
}`;
const BE_SVC = `export class BeService { all() { return []; } }`;

const NESTED_ROOTS = [root({ id: "acme", name: "ACME", projectId: "p1" })];

const NESTED_TREE: Record<string, CodeListingDto> = {
  "acme::": listing([
    { name: "apps", rel: "apps", kind: "dir" },
    { name: "docs", rel: "docs", kind: "dir" },
  ]),
  "acme::apps": listing([
    { name: "fe", rel: "apps/fe", kind: "dir" },
    { name: "be", rel: "apps/be", kind: "dir" },
  ]),
  "acme::apps/fe": listing([
    { name: "package.json", rel: "apps/fe/package.json", kind: "file" },
    { name: "angular.json", rel: "apps/fe/angular.json", kind: "file" },
    { name: "app.controller.ts", rel: "apps/fe/app.controller.ts", kind: "file" },
    { name: "app.service.ts", rel: "apps/fe/app.service.ts", kind: "file" },
  ]),
  "acme::apps/be": listing([
    { name: "package.json", rel: "apps/be/package.json", kind: "file" },
    { name: "nest-cli.json", rel: "apps/be/nest-cli.json", kind: "file" },
    { name: "app.controller.ts", rel: "apps/be/app.controller.ts", kind: "file" },
    { name: "app.service.ts", rel: "apps/be/app.service.ts", kind: "file" },
  ]),
  "acme::docs": listing([{ name: "guide.md", rel: "docs/guide.md", kind: "file" }]),
};

const NESTED_CONTENTS: Record<string, string> = {
  "acme::apps/fe/app.controller.ts": FE_CTRL,
  "acme::apps/fe/app.service.ts": FE_SVC,
  "acme::apps/be/app.controller.ts": BE_CTRL,
  "acme::apps/be/app.service.ts": BE_SVC,
};

function nestedDeps(overrides: Partial<ProjectMapDeps> = {}): ProjectMapDeps {
  return {
    listDir: async (rootId, rel) =>
      NESTED_TREE[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
    readFile: async (rootId, rel) => {
      if (rel.endsWith("package.json")) {
        return { text: `{"name":"${rel}"}`, fingerprint: "h", size: 10 };
      }
      const text = NESTED_CONTENTS[`${rootId}::${rel}`];
      if (text === undefined) throw { kind: "code_not_found", message: "missing" };
      return { text, fingerprint: "h", size: text.length };
    },
    analyzeTs: (files) => Promise.resolve(analyzeTsFiles(files)),
    ...overrides,
  };
}

function batchDeps(n: number): ProjectMapDeps {
  const files: Record<string, string> = {};
  const entries: Array<{ name: string; rel: string; kind: "file" }> = [
    { name: "package.json", rel: "big/package.json", kind: "file" },
  ];
  for (let i = 0; i < n; i += 1) {
    const rel = `big/f${i}.ts`;
    entries.push({ name: `f${i}.ts`, rel, kind: "file" });
    files[`acme::${rel}`] = `export class C${i} { v = ${i}; }`;
  }
  const tree: Record<string, CodeListingDto> = {
    "acme::": listing([{ name: "big", rel: "big", kind: "dir" }]),
    "acme::big": listing(entries),
  };
  return nestedDeps({
    listDir: async (rootId, rel) => tree[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
    readFile: async (rootId, rel) => {
      if (rel.endsWith("package.json")) {
        return { text: `{"name":"big"}`, fingerprint: "h", size: 10 };
      }
      const text = files[`${rootId}::${rel}`];
      if (text === undefined) throw { kind: "code_not_found", message: "missing" };
      return { text, fingerprint: "h", size: text.length };
    },
  });
}

describe("nested project scopes", () => {
  beforeEach(() => clearDiscoveryCache());

  it("shows one section per detected project, never the whole root", async () => {
    renderView({ roots: NESTED_ROOTS, deps: nestedDeps() });
    const fe = await screen.findByLabelText("Diagram of fe");
    const be = await screen.findByLabelText("Diagram of be");
    expect(fe).toBeTruthy();
    expect(be).toBeTruthy();
    expect(screen.queryByLabelText("Diagram of ACME")).toBeNull();
    // Sibling exclusion: each section only lists its own files.
    expect(
      await within(fe).findByRole("button", { name: "apps/fe/app.controller.ts, 1 symbols" }),
    ).toBeTruthy();
    expect(within(fe).queryByText(/apps\/be\//)).toBeNull();
    expect(
      within(be).getByRole("button", { name: "apps/be/app.controller.ts, 1 symbols" }),
    ).toBeTruthy();
    expect(within(be).queryByText(/apps\/fe\//)).toBeNull();
  });

  it("selecting a project shows only that project", async () => {
    const { setScope } = renderView({ roots: NESTED_ROOTS, deps: nestedDeps() });
    expect(await screen.findByLabelText("Diagram of fe")).toBeTruthy();
    // The tree drives the scope; the center follows with a breadcrumb.
    setScope({ kind: "project", rootId: "acme", rel: "apps/fe" });
    await waitFor(() => expect(screen.queryByLabelText("Diagram of be")).toBeNull());
    expect(screen.getByLabelText("Diagram of fe")).toBeTruthy();
    const chip = within(statusBar()).getByRole("button", { name: /^Scoped to/ });
    expect(chip.textContent).toBe("ACME › fe ×");
    setScope({ kind: "all" });
    expect(await screen.findByLabelText("Diagram of be")).toBeTruthy();
  });

  it("renders a controlled single scope with a way back", async () => {
    const onScopeChange = vi.fn();
    renderView({
      roots: NESTED_ROOTS,
      deps: nestedDeps(),
      scope: { kind: "project", rootId: "acme", rel: "apps/fe" },
      onScopeChange,
    });
    expect(await screen.findByLabelText("Diagram of fe")).toBeTruthy();
    expect(screen.queryByLabelText("Diagram of be")).toBeNull();
    fireEvent.click(
      within(statusBar()).getByRole("button", { name: /Show all projects/ }),
    );
    expect(onScopeChange).toHaveBeenCalledWith({ kind: "all" });
  });

  it("drops stale responses on rapid scope switches", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = nestedDeps({
      analyzeTs: async (files) => {
        await gate;
        return analyzeTsFiles(files);
      },
    });
    function Harness() {
      const [scope, setScope] = useState<ArchScope>({ kind: "all" });
      (Harness as unknown as { setScope: (scope: ArchScope) => void }).setScope = setScope;
      return (
        <ProjectMapView
          projectId="p1"
          roots={NESTED_ROOTS}
          hidden={{}}
          onToggleRoot={() => {}}
          tabs={[]}
          deps={deps}
          groupBy="files"
          scope={scope}
          onScopeChange={setScope}
          hiddenProjects={{}}
          onShowAllProjects={() => {}}
        />
      );
    }
    render(<Harness />);
    expect(await screen.findAllByText("Analyzing…")).toBeTruthy();
    act(() =>
      (Harness as unknown as { setScope: (scope: ArchScope) => void }).setScope({
        kind: "project",
        rootId: "acme",
        rel: "apps/be",
      }),
    );
    release();
    const be = await screen.findByLabelText("Diagram of be");
    expect(within(be).getByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    expect(screen.queryByLabelText("Diagram of fe")).toBeNull();
  });

  it("continues truncated collections in batches", async () => {
    const files: Record<string, string> = {};
    const entries: Array<{ name: string; rel: string; kind: "file" }> = [
      { name: "package.json", rel: "big/package.json", kind: "file" },
    ];
    for (let i = 0; i < 205; i += 1) {
      const rel = `big/f${i}.ts`;
      entries.push({ name: `f${i}.ts`, rel, kind: "file" });
      files[`acme::${rel}`] = `export const v${i} = ${i};`;
    }
    const tree: Record<string, CodeListingDto> = {
      "acme::": listing([{ name: "big", rel: "big", kind: "dir" }]),
      "acme::big": listing(entries),
    };
    const deps = nestedDeps({
      listDir: async (rootId, rel) => tree[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
      readFile: async (rootId, rel) => {
        if (rel.endsWith("package.json")) {
          return { text: `{"name":"big"}`, fingerprint: "h", size: 10 };
        }
        const text = files[`${rootId}::${rel}`];
        if (text === undefined) throw { kind: "code_not_found", message: "missing" };
        return { text, fingerprint: "h", size: text.length };
      },
    });
    renderView({ roots: NESTED_ROOTS, deps });
    await screen.findByLabelText("Diagram of big");
    const details = await openDetails();
    expect(await details.findByText(/first 200 files collected/)).toBeTruthy();
    fireEvent.click(details.getByRole("button", { name: /Load more files/ }));
    // Collection completes (the analyzer still caps at 20 files per batch).
    await waitFor(() => expect(details.queryByText(/first 200 files collected/)).toBeNull());
    await waitFor(() => expect(statusBar().textContent).toMatch(/205\/205 files analyzed/));
    // Every file is analyzed; the map draws up to its cap and says so.
    expect(details.getByText("0 symbols · 200 files · 0 edges")).toBeTruthy();
    expect(details.getByText(/first 200 files drawn/)).toBeTruthy();
  });

  it("analyzes every batch on its own, with no button to press", async () => {
    const analyzeTs = vi.fn((files: Parameters<ProjectMapDeps["analyzeTs"]>[0]) =>
      Promise.resolve(analyzeTsFiles(files)),
    );
    renderView({ roots: NESTED_ROOTS, deps: { ...batchDeps(25), analyzeTs } });
    await screen.findByLabelText("Diagram of big");
    await waitFor(() => expect(statusBar().textContent).toMatch(/25\/25 files analyzed/));
    // The analyzer cap (20 files per call) stays, split in two calls.
    expect(analyzeTs).toHaveBeenCalledTimes(2);
    expect(statusBar().textContent).not.toMatch(/pending/);
    expect(within(statusBar()).queryByRole("button", { name: /Continue analysis/ })).toBeNull();
    const details = await openDetails();
    expect(details.getByText("25 symbols · 25 files · 0 edges")).toBeTruthy();
  });

  it("counts failed and excluded files separately", async () => {
    const tree: Record<string, CodeListingDto> = {
      ...NESTED_TREE,
      "acme::apps/be": listing([
        { name: "package.json", rel: "apps/be/package.json", kind: "file" },
        { name: "nest-cli.json", rel: "apps/be/nest-cli.json", kind: "file" },
        { name: "app.controller.ts", rel: "apps/be/app.controller.ts", kind: "file" },
        { name: "broken.ts", rel: "apps/be/broken.ts", kind: "file" },
        { name: "legacy", rel: "apps/be/legacy", kind: "dir" },
      ]),
      "acme::apps/be/legacy": listing([
        { name: "package.json", rel: "apps/be/legacy/package.json", kind: "file" },
        { name: "old.ts", rel: "apps/be/legacy/old.ts", kind: "file" },
      ]),
    };
    const deps = nestedDeps({
      listDir: async (rootId, rel) => tree[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
      readFile: async (rootId, rel) => {
        if (rel.endsWith("package.json")) {
          return { text: `{"name":"${rel}"}`, fingerprint: "h", size: 10 };
        }
        if (rel === "apps/be/broken.ts") throw { kind: "code_nope", message: "denied" };
        if (rel === "apps/be/legacy/old.ts") {
          return { text: "export class Old {}", fingerprint: "h", size: 18 };
        }
        return nestedDeps().readFile(rootId, rel);
      },
    });
    renderView({ roots: NESTED_ROOTS, deps });
    const be = await screen.findByLabelText("Diagram of be");
    await within(be).findByRole("heading", { name: "Controllers (1 file)" });
    // 1 readable file analyzed, 1 unreadable, 1 nested subtree out.
    const beDetails = within((await openDetails()).getByRole("region", { name: "Details of be" }));
    expect(beDetails.getByText(/Could not read apps\/be\/broken\.ts/)).toBeTruthy();
    expect(beDetails.getByText("Excluded 1 nested project(s).")).toBeTruthy();
    expect(beDetails.queryByRole("button", { name: /Analyze more/ })).toBeNull();
    expect(statusBar().textContent).toMatch(/1 failed/);
    expect(statusBar().textContent).not.toMatch(/pending/);
  });

  it("cancels a running analysis and retries cleanly", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = nestedDeps({
      analyzeTs: async (files) => {
        await gate;
        return analyzeTsFiles(files);
      },
    });
    renderView({
      roots: NESTED_ROOTS,
      deps,
      scope: { kind: "project", rootId: "acme", rel: "apps/fe" },
    });
    const section = await screen.findByLabelText("Diagram of fe");
    expect(await within(section).findByText("Analyzing…")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Cancel" }));
    expect(await within(section).findByText("Cancelled.")).toBeTruthy();
    release();
    fireEvent.click(within(section).getByRole("button", { name: "Retry" }));
    expect(await within(section).findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
  });

  it("shows an honest empty state without reusing the previous map", async () => {
    renderView({
      roots: NESTED_ROOTS,
      deps: nestedDeps(),
      scope: { kind: "folder", rootId: "acme", rel: "docs" },
    });
    const section = await screen.findByLabelText("Diagram of docs (folder)");
    expect(await within(section).findByText("No supported source files.")).toBeTruthy();
  });

  it("hides projects in the joint view and restores them with Show all", async () => {
    const onShowAllProjects = vi.fn();
    renderView({
      roots: NESTED_ROOTS,
      deps: nestedDeps(),
      hiddenProjects: { "acme::apps/fe": true },
      onShowAllProjects,
    });
    expect(await screen.findByLabelText("Diagram of be")).toBeTruthy();
    expect(screen.queryByLabelText("Diagram of fe")).toBeNull();
    cleanup();
    renderView({
      roots: NESTED_ROOTS,
      deps: nestedDeps(),
      hiddenProjects: { "acme::apps/fe": true, "acme::apps/be": true },
      onShowAllProjects,
    });
    expect(await screen.findByText(/Everything is hidden from view/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onShowAllProjects).toHaveBeenCalledTimes(1);
  });

  it("analyzes an explicit folder including nested projects", async () => {
    renderView({
      roots: NESTED_ROOTS,
      deps: nestedDeps(),
      scope: { kind: "folder", rootId: "acme", rel: "apps" },
    });
    const section = await screen.findByLabelText("Diagram of apps (folder)");
    expect(await within(section).findByRole("heading", { name: "Controllers (2 files)" })).toBeTruthy();
  });

  it("excludes nested projects from their parent scope", async () => {
    const tree: Record<string, CodeListingDto> = {
      ...NESTED_TREE,
      "acme::apps/be": listing([
        { name: "package.json", rel: "apps/be/package.json", kind: "file" },
        { name: "nest-cli.json", rel: "apps/be/nest-cli.json", kind: "file" },
        { name: "app.controller.ts", rel: "apps/be/app.controller.ts", kind: "file" },
        { name: "legacy", rel: "apps/be/legacy", kind: "dir" },
      ]),
      "acme::apps/be/legacy": listing([
        { name: "package.json", rel: "apps/be/legacy/package.json", kind: "file" },
        { name: "old.ts", rel: "apps/be/legacy/old.ts", kind: "file" },
      ]),
    };
    const deps = nestedDeps({
      listDir: async (rootId, rel) => tree[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
      readFile: async (rootId, rel) => {
        if (rel.endsWith("package.json")) {
          return { text: `{"name":"${rel}"}`, fingerprint: "h", size: 10 };
        }
        if (rel === "apps/be/legacy/old.ts") {
          return { text: "export class Old {}", fingerprint: "h", size: 18 };
        }
        return nestedDeps().readFile(rootId, rel);
      },
    });
    renderView({ roots: NESTED_ROOTS, deps });
    const be = await screen.findByLabelText("Diagram of be");
    await within(be).findByRole("heading", { name: "Controllers (1 file)" });
    expect(within(be).queryByText(/apps\/be\/legacy\//)).toBeNull();
    const details = await openDetails();
    expect(
      within(details.getByRole("region", { name: "Details of be" })).getByText(
        "Excluded 1 nested project(s).",
      ),
    ).toBeTruthy();
    fireEvent.click(details.getByRole("button", { name: "Close analysis details" }));
    // The nested project maps on its own section instead.
    expect(await screen.findByLabelText("Diagram of legacy")).toBeTruthy();
  });

  it("switching projects swaps the map and the breadcrumb", async () => {
    const { setScope } = renderView({ roots: NESTED_ROOTS, deps: nestedDeps() });
    expect(await screen.findByLabelText("Diagram of fe")).toBeTruthy();
    setScope({ kind: "project", rootId: "acme", rel: "apps/be" });
    const be = await screen.findByLabelText("Diagram of be");
    expect(screen.queryByLabelText("Diagram of fe")).toBeNull();
    expect(await within(be).findByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    const chip = within(statusBar()).getByRole("button", { name: /^Scoped to/ });
    expect(chip.textContent).toBe("ACME › be ×");
  });

  it("clears the selection on scope switches without losing expansion", async () => {
    const { setScope } = renderView({ roots: NESTED_ROOTS, deps: nestedDeps(), zoom: 1.5 });
    const fe = await screen.findByLabelText("Diagram of fe");
    const card = await within(fe).findByRole("button", {
      name: "apps/fe/app.controller.ts, 1 symbols",
    });
    fireEvent.click(card);
    expect(screen.getByRole("complementary", { name: "Board inspector" }).textContent).toMatch(
      /FeController/,
    );
    // Open the member list, then switch away and back.
    fireEvent.click(
      within(fe).getByRole("button", { name: "FeController, 2 members" }),
    );
    expect(within(fe).getByTitle(/constructor\(private readonly svc/)).toBeTruthy();
    setScope({ kind: "project", rootId: "acme", rel: "apps/be" });
    await screen.findByLabelText("Diagram of be");
    expect(screen.queryByText(/FeController/)).toBeNull();
    expect(screen.getByText(/Select a card/)).toBeTruthy();
    setScope({ kind: "all" });
    const feAgain = await screen.findByLabelText("Diagram of fe");
    // Compatible preferences survive: zoom and expansion are intact.
    expect(
      (feAgain.querySelector(".archmap-zoom") as HTMLElement).getAttribute("style") ?? "",
    ).toContain("zoom: 1.5");
    expect(await within(feAgain).findByTitle(/constructor\(private readonly svc/)).toBeTruthy();
  });

  it("showing all restores cached maps without re-analyzing", async () => {
    const analyzeTs = vi.fn((files: Parameters<ProjectMapDeps["analyzeTs"]>[0]) =>
      Promise.resolve(analyzeTsFiles(files)),
    );
    const { setHiddenProjects } = renderView({
      roots: NESTED_ROOTS,
      deps: nestedDeps({ analyzeTs }),
    });
    expect(await screen.findByLabelText("Diagram of fe")).toBeTruthy();
    expect(await screen.findByLabelText("Diagram of be")).toBeTruthy();
    const calls = analyzeTs.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    setHiddenProjects({ "acme::apps/fe": true });
    await waitFor(() => expect(screen.queryByLabelText("Diagram of fe")).toBeNull());
    setHiddenProjects({});
    expect(await screen.findByLabelText("Diagram of fe")).toBeTruthy();
    expect(analyzeTs.mock.calls.length).toBe(calls);
  });

  it("scopes to a project outside the associated roots", async () => {
    const other = root({ id: "other", name: "other", projectId: null });
    const tree: Record<string, CodeListingDto> = {
      ...NESTED_TREE,
      "other::": listing([{ name: "svc", rel: "svc", kind: "dir" }]),
      "other::svc": listing([
        { name: "package.json", rel: "svc/package.json", kind: "file" },
        { name: "svc.ts", rel: "svc/svc.ts", kind: "file" },
      ]),
    };
    const deps = nestedDeps({
      listDir: async (rootId, rel) => tree[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
      readFile: async (rootId, rel) => {
        if (rel.endsWith("package.json")) {
          return { text: `{"name":"${rel}"}`, fingerprint: "h", size: 10 };
        }
        if (rootId === "other") {
          return { text: "export class Svc {}", fingerprint: "h", size: 18 };
        }
        return nestedDeps().readFile(rootId, rel);
      },
    });
    render(
      <ProjectMapView
        projectId="p1"
        roots={[...NESTED_ROOTS, other]}
        hidden={{}}
        onToggleRoot={() => {}}
        tabs={[]}
        deps={deps}
        groupBy="files"
        scope={{ kind: "project", rootId: "other", rel: "svc" }}
        onScopeChange={() => {}}
        hiddenProjects={{}}
        onShowAllProjects={() => {}}
      />,
    );
    expect(await screen.findByLabelText("Diagram of svc")).toBeTruthy();
    expect(screen.queryByLabelText("Diagram of fe")).toBeNull();
  });

  it("reports detected-but-unanalyzed projects honestly", async () => {
    const tree: Record<string, CodeListingDto> = {
      ...NESTED_TREE,
      "acme::apps": listing([
        { name: "fe", rel: "apps/fe", kind: "dir" },
        { name: "jobs", rel: "apps/jobs", kind: "dir" },
      ]),
      "acme::apps/jobs": listing([
        { name: "pom.xml", rel: "apps/jobs/pom.xml", kind: "file" },
        { name: "App.java", rel: "apps/jobs/App.java", kind: "file" },
      ]),
    };
    const analyzeTs = vi.fn((files: Parameters<ProjectMapDeps["analyzeTs"]>[0]) =>
      Promise.resolve(analyzeTsFiles(files)),
    );
    const deps = nestedDeps({
      listDir: async (rootId, rel) => tree[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
      analyzeTs,
    });
    const roots = [root({ id: "acme", name: "ACME", projectId: "p1" })];
    renderView({ roots, deps });
    const section = await screen.findByLabelText("Diagram of jobs");
    expect(
      await within(section).findByText("Detected Java project — maps analyze TypeScript only."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(analyzeTs.mock.calls.every((call) => call[0].length > 0)).toBe(true),
    );
    const analyzed = analyzeTs.mock.calls.flatMap((call) =>
      call[0].map((f: { rel: string }) => f.rel),
    );
    expect(analyzed).not.toContain("apps/jobs/App.java");
  });

  it("filters tests and configs only through their toggles, counted", async () => {
    const tree: Record<string, CodeListingDto> = {
      "acme::": listing([{ name: "app", rel: "app", kind: "dir" }]),
      "acme::app": listing([
        { name: "package.json", rel: "app/package.json", kind: "file" },
        { name: "a.service.ts", rel: "app/a.service.ts", kind: "file" },
        { name: "a.service.spec.ts", rel: "app/a.service.spec.ts", kind: "file" },
        { name: "app.config.ts", rel: "app/app.config.ts", kind: "file" },
      ]),
    };
    const deps = nestedDeps({
      listDir: async (rootId, rel) => tree[`${rootId}::${rel}`] ?? { entries: [], truncated: false },
      readFile: async (_rootId, rel) => {
        if (rel.endsWith("package.json")) {
          return { text: `{"name":"app"}`, fingerprint: "h", size: 10 };
        }
        return { text: "export class A {}", fingerprint: "h", size: 18 };
      },
    });
    const { rerender } = (() => {
      const utils = render(
        <ProjectMapView
          projectId="p1"
          roots={NESTED_ROOTS}
          hidden={{}}
          onToggleRoot={() => {}}
          tabs={[]}
          deps={deps}
          groupBy="files"
          showTests={false}
          showConfig={false}
          scope={{ kind: "all" }}
          onScopeChange={() => {}}
          hiddenProjects={{}}
          onShowAllProjects={() => {}}
        />,
      );
      return utils;
    })();
    const section = await screen.findByLabelText("Diagram of app");
    expect(await within(section).findByRole("heading", { name: "Services (1 file)" })).toBeTruthy();
    // Hidden-by-filter counts ride on the Layers menu, never silent.
    const layers = screen.getByRole("button", { name: "Layers, 2 hidden" });
    expect(layers.getAttribute("title")).toBe("1 test file and 1 config file");
    expect(within(section).queryByText(/\.spec\.ts/)).toBeNull();
    rerender(
      <ProjectMapView
        projectId="p1"
        roots={NESTED_ROOTS}
        hidden={{}}
        onToggleRoot={() => {}}
        tabs={[]}
        deps={deps}
        groupBy="files"
        showTests={true}
        showConfig={true}
        scope={{ kind: "all" }}
        onScopeChange={() => {}}
        hiddenProjects={{}}
        onShowAllProjects={() => {}}
      />,
    );
    expect(await within(section).findByRole("heading", { name: "Unassigned (2 files)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Layers, \d+ hidden/ })).toBeNull();
  });

  it("enters Flow mode from one member through the inspector", async () => {
    renderView({ groupBy: "symbols" });
    fireEvent.click(await screen.findByRole("button", { name: /^Method: all/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Show flow of all" }));
    expect(await screen.findByText(/Flow: SalesService\.all\(\)/)).toBeTruthy();
  });

  it("leaves Flow mode when the scope changes", async () => {
    const { setScope } = renderView({ roots: NESTED_ROOTS, deps: nestedDeps(), groupBy: "symbols" });
    fireEvent.click(await screen.findByRole("button", { name: /^Show flow of BeController/ }));
    expect(await screen.findByRole("button", { name: /^Leave flow/ })).toBeTruthy();
    setScope({ kind: "project", rootId: "acme", rel: "apps/fe" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Leave flow/ })).toBeNull());
  });

  it("keeps a cancelled analysis honest and continues it on request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const deps: ProjectMapDeps = {
      ...batchDeps(25),
      analyzeTs: async (files) => {
        calls += 1;
        if (calls === 2) await gate;
        return analyzeTsFiles(files);
      },
    };
    renderView({ roots: NESTED_ROOTS, deps, groupBy: "symbols" });
    const section = await screen.findByLabelText("Diagram of big");
    fireEvent.click(await within(section).findByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Show flow of C0/ }));
    expect(await screen.findByText(/Partial chain: 5 files not analyzed/)).toBeTruthy();
    release();
    fireEvent.click(screen.getByRole("button", { name: "Analyze all" }));
    await waitFor(() => expect(screen.queryByText(/Partial chain/)).toBeNull());
    expect(statusBar().textContent).toMatch(/25\/25 files analyzed/);
  });

  it("starts with the inspector closed and lights it when data is ready", async () => {
    useRequirementsUi.setState({ archInspectorCollapsed: true });
    renderView({ groupBy: "symbols" });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    expect(screen.queryByRole("complementary", { name: "Board inspector" })).toBeNull();
    const idle = screen.getByRole("button", { name: "Show inspector" });
    expect(idle.className).not.toContain("has-data");
    fireEvent.click(screen.getByRole("button", { name: /^SalesController, class/ }));
    const ready = await screen.findByRole("button", { name: "Show inspector, details ready" });
    expect(ready.className).toContain("has-data");
    expect(screen.queryByRole("complementary", { name: "Board inspector" })).toBeNull();
  });

  it("opens the inspector when a proposal needs a decision", async () => {
    useRequirementsUi.setState({ archInspectorCollapsed: true });
    const { setProposalFiles } = renderView({ groupBy: "symbols" });
    await screen.findByRole("button", { name: "Show flow of SalesController" });
    setProposalFiles([proposalFile("src/report.ts", `export class Report {}`, "create")]);
    expect(await screen.findByRole("complementary", { name: "Board inspector" })).toBeTruthy();
  });

  it("hosts extra actions and a drawer in the status bar", async () => {
    renderView({ footerActions: <button type="button">Extra</button>, footerDrawer: <p>Drawer</p> });
    const bar = await screen.findByLabelText("Analysis status");
    expect(within(bar).getByRole("button", { name: "Extra" })).toBeTruthy();
    expect(within(bar).getByText("Drawer")).toBeTruthy();
  });
});
