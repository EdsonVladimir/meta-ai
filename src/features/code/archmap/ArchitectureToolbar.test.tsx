// @vitest-environment jsdom
// Compact canvas toolbar: module select with grouped options,
// external-refs toggle, search, layer/edge menus, grouping,
// and the analysis Details panel. Presentational: every action
// arrives as a callback.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ArchitectureToolbar } from "./ArchitectureToolbar";
import type { CodeModuleOption } from "./codeModules";
import { allLayersOn } from "./mapFilter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MODULES: CodeModuleOption[] = [
  {
    key: "declared:mod:s1",
    kind: "declared",
    label: "SalesModule",
    criterion: "Declared by @Module in sales.module.ts: 3 symbols",
    symbols: 3,
  },
  {
    key: "manual:m1",
    kind: "manual",
    label: "Ventas",
    criterion: 'Ruth module "Ventas" linked to 1 path: 3 symbols',
    symbols: 3,
  },
  {
    key: "dir:be::::src/sales",
    kind: "directory",
    label: "sales",
    criterion: "Folder grouping under src/sales/: 4 symbols (not a declared module)",
    symbols: 4,
  },
];

function renderToolbar(overrides: Partial<Parameters<typeof ArchitectureToolbar>[0]> = {}) {
  const props = {
    modules: MODULES,
    moduleKey: null as string | null,
    onModuleChange: vi.fn(),
    moduleLine: null as string | null,
    modulePartial: null as string | null,
    showExternal: false,
    onToggleExternal: vi.fn(),
    externalInfo: null as string | null,
    groupBy: "symbols" as const,
    onGroupByChange: vi.fn(),
    query: "",
    onQueryChange: vi.fn(),
    layersOn: allLayersOn(),
    onToggleLayer: vi.fn(),
    showTests: true,
    onToggleTests: vi.fn(),
    showConfig: true,
    onToggleConfig: vi.fn(),
    hiddenByFilters: 0,
    hiddenByFiltersTitle: null as string | null,
    edgeOpts: { incoming: true, outgoing: true, depth: 1 as const },
    onToggleIncoming: vi.fn(),
    onToggleOutgoing: vi.fn(),
    onDepthChange: vi.fn(),
    detailsBadge: null as string | null,
    detailsOpen: false,
    onOpenDetails: vi.fn(),
    onCloseDetails: vi.fn(),
    detailRows: [],
    hiddenEntries: [],
    onDetailRetry: vi.fn(),
    onDetailCancel: vi.fn(),
    onDetailContinue: vi.fn(),
    onDetailLoadMore: vi.fn(),
    onShowHidden: vi.fn(),
    onShowAllHidden: vi.fn(),
    ...overrides,
  };
  render(<ArchitectureToolbar {...props} />);
  return props;
}

describe("ArchitectureToolbar", () => {
  it("selects modules from grouped options, defaulting to all", () => {
    const props = renderToolbar();
    const select = screen.getByRole("combobox", { name: "Module filter" });
    expect((select as HTMLSelectElement).value).toBe("all");
    expect(screen.getByRole("option", { name: "All modules" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "SalesModule (3)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ventas (3)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "sales (4)" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "declared:mod:s1" } });
    expect(props.onModuleChange).toHaveBeenCalledWith("declared:mod:s1");
    fireEvent.change(select, { target: { value: "all" } });
    expect(props.onModuleChange).toHaveBeenCalledWith(null);
  });

  it("shows the module criterion with partial and external notes", () => {
    renderToolbar({
      moduleKey: "dir:be::::src/sales",
      moduleLine: "Folder grouping under src/sales/: 4 symbols (not a declared module)",
      modulePartial: "results may be incomplete: 6 files pending",
      showExternal: true,
      externalInfo: "20 of 34 references shown",
    });
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Folder grouping under src/sales/");
    expect(line.textContent).toContain("results may be incomplete");
    expect(line.textContent).toContain("20 of 34 references shown");
    expect(screen.getByLabelText("External refs")).toBeTruthy();
  });

  it("offers external refs only with a module, symbols board only", () => {
    const props = renderToolbar({ moduleKey: null });
    expect(screen.queryByLabelText("External refs")).toBeNull();
    cleanup();
    renderToolbar({ ...props, moduleKey: "dir:be::::src/sales", groupBy: "files" });
    const toggle = screen.getByLabelText("External refs") as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.closest("label")?.getAttribute("title")).toContain("Symbols board");
  });

  it("explains an empty module list instead of hiding the select", () => {
    renderToolbar({
      modules: [],
      moduleLine: "All modules: no @Module declarations, linked folders, or subfolders here.",
    });
    const select = screen.getByRole("combobox", { name: "Module filter" });
    expect(select.querySelectorAll("option")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("no @Module declarations");
  });

  it("filters layers, tests, config and search from the menus", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByLabelText("Services"));
    expect(props.onToggleLayer).toHaveBeenCalledWith("services");
    fireEvent.click(screen.getByLabelText("Tests"));
    expect(props.onToggleTests).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Config"));
    expect(props.onToggleConfig).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Filter boards"), { target: { value: "sales" } });
    expect(props.onQueryChange).toHaveBeenCalledWith("sales");
  });

  it("badges the layers menu with honest hidden counts", () => {
    renderToolbar({ hiddenByFilters: 3, hiddenByFiltersTitle: "2 test files, 1 config file" });
    const button = screen.getByRole("button", { name: "Layers, 3 hidden" });
    expect(button.getAttribute("title")).toContain("2 test files");
  });

  it("controls edge direction and depth with a legend", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Edges" }));
    fireEvent.click(screen.getByLabelText("Incoming"));
    expect(props.onToggleIncoming).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Outgoing"));
    expect(props.onToggleOutgoing).toHaveBeenCalledTimes(1);
    const depth2 = screen.getByRole("button", { name: "2" });
    fireEvent.click(depth2);
    expect(props.onDepthChange).toHaveBeenCalledWith(2);
    const legend = screen.getByRole("group", { name: "Connection legend" });
    expect(legend.textContent).toMatch(/imports/);
    expect(legend.textContent).toMatch(/references/);
    expect(legend.textContent).not.toMatch(/call/i);
  });

  it("switches card grouping between symbols and files", () => {
    const props = renderToolbar({ groupBy: "symbols" });
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(props.onGroupByChange).toHaveBeenCalledWith("files");
  });

  it("opens details with per-section rows, actions and hidden recovery", () => {
    const props = renderToolbar({
      detailsBadge: "2",
      detailsOpen: true,
      detailRows: [
        {
          key: "be::",
          title: "backend",
          status: "Analyzing…",
          notes: ["excluded 1 nested project", "External packages: 4."],
          showRetry: false,
          showCancel: true,
          continueLabel: "Analyze more (6 pending)",
          showLoadMore: false,
        },
        {
          key: "fe::",
          title: "frontend",
          status: "Analysis failed",
          notes: ["None of the collected files could be read."],
          showRetry: true,
          showCancel: false,
          continueLabel: null,
          showLoadMore: true,
        },
      ],
      hiddenEntries: [{ key: "fe::apps/old", label: "old", kind: "project" }],
    });
    expect(screen.getByRole("button", { name: "Details (2)" })).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Analysis details" });
    expect(within(dialog).getByText("backend")).toBeTruthy();
    expect(within(dialog).getByText(/excluded 1 nested/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Analyze more (6 pending)" }));
    expect(props.onDetailContinue).toHaveBeenCalledWith("be::");
    fireEvent.click(
      within(within(dialog).getByLabelText("Details of frontend")).getByRole("button", {
        name: "Retry",
      }),
    );
    expect(props.onDetailRetry).toHaveBeenCalledWith("fe::");
    fireEvent.click(
      within(within(dialog).getByLabelText("Hidden from view")).getByRole("button", {
        name: "Show",
      }),
    );
    expect(props.onShowHidden).toHaveBeenCalledWith({
      key: "fe::apps/old",
      label: "old",
      kind: "project",
    });
    fireEvent.click(screen.getByRole("button", { name: "Close analysis details" }));
    expect(props.onCloseDetails).toHaveBeenCalledTimes(1);
  });

  it("closes the details empty state without actions", () => {
    renderToolbar({ detailsOpen: true });
    expect(screen.getByText("Nothing to report.")).toBeTruthy();
  });
});
