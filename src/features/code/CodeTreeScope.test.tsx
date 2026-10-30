// @vitest-environment jsdom
// Code tree scope: chevron expands without touching the Architecture
// scope, project names activate it, plain folders only select for
// exploring, and every detected project (nested included) carries
// its own visibility eye. Backend fully mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CodeTree } from "./CodeTree";
import { clearDiscoveryCache } from "./detectProjects";
import type { ArchScope } from "../requirements/uiStore";
import type { CodeEntryDto, CodeListingDto, CodeRootDto } from "./types";

vi.mock("./client", () => ({
  listCodeDir: vi.fn(),
  readCodeFile: vi.fn(),
  normalizeCodeError: (raw: unknown) => ({ kind: "unknown", message: String(raw) }),
}));

import { listCodeDir, readCodeFile } from "./client";

const mockedListDir = vi.mocked(listCodeDir);
const mockedReadFile = vi.mocked(readCodeFile);

afterEach(() => cleanup());
beforeEach(() => {
  clearDiscoveryCache();
  vi.clearAllMocks();
});

function root(): CodeRootDto {
  return { id: "r1", path: "/repo/acme", name: "ACME", missing: false, projectId: "p1" };
}

function dir(rel: string): CodeEntryDto {
  return { name: rel.split("/").pop() ?? rel, rel, kind: "dir", size: null };
}

function file(rel: string): CodeEntryDto {
  return { name: rel.split("/").pop() ?? rel, rel, kind: "file", size: 10 };
}

function listing(entries: CodeEntryDto[]): CodeListingDto {
  return { entries, truncated: false };
}

const TREE: Record<string, CodeListingDto> = {
  "": listing([dir("apps"), dir("docs"), file("readme.md")]),
  apps: listing([dir("apps/fe"), dir("apps/be")]),
  "apps/fe": listing([file("apps/fe/package.json"), file("apps/fe/angular.json"), file("apps/fe/app.ts")]),
  "apps/be": listing([file("apps/be/package.json"), file("apps/be/nest-cli.json")]),
  docs: listing([file("docs/guide.md")]),
};

function mockBackend() {
  mockedListDir.mockImplementation(async (_rootId: string, rel: string) => TREE[rel] ?? listing([]));
  mockedReadFile.mockImplementation(async (_rootId: string, rel: string) => ({
    text: rel.endsWith("package.json") ? `{"name":"${rel}"}` : "",
    fingerprint: "h",
    size: 10,
  }));
}

function renderTree(options: {
  archScope?: ArchScope;
  onArchScope?: (scope: ArchScope) => void;
  folderSelection?: { rootId: string; rel: string } | null;
  onSelectFolder?: (rootId: string, rel: string) => void;
  onAnalyzeFolder?: (rootId: string, rel: string) => void;
  hiddenProjects?: Record<string, boolean>;
  onToggleMapProject?: (key: string) => void;
  onOpenFile?: (root: CodeRootDto, entry: CodeEntryDto) => void;
}) {
  const props = {
    roots: [root()],
    loading: false,
    error: null,
    onRetry: () => {},
    onAddRoot: () => {},
    adding: false,
    onRemoveRoot: () => {},
    onOpenFile: options.onOpenFile ?? (() => {}),
    onTerminalAt: () => {},
    archScope: options.archScope ?? { kind: "all" as const },
    onArchScope: options.onArchScope ?? (() => {}),
    folderSelection: options.folderSelection ?? null,
    onSelectFolder: options.onSelectFolder ?? (() => {}),
    onAnalyzeFolder: options.onAnalyzeFolder ?? (() => {}),
    hiddenProjects: options.hiddenProjects ?? {},
    onToggleMapProject: options.onToggleMapProject ?? (() => {}),
  };
  return render(<CodeTree {...props} />);
}

async function expandRow(name: string) {
  const row = (await screen.findByText(name)).closest("li") ?? document.body;
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /^(Expand|Collapse)/ }));
}

describe("code tree scope", () => {
  it("expands with the chevron without changing the scope", async () => {
    mockBackend();
    const onArchScope = vi.fn();
    const onSelectFolder = vi.fn();
    renderTree({ onArchScope, onSelectFolder });
    await expandRow("ACME");
    expect(await screen.findByText("apps")).toBeTruthy();
    await expandRow("apps");
    expect(await screen.findByText("fe")).toBeTruthy();
    expect(onArchScope).not.toHaveBeenCalled();
    expect(onSelectFolder).not.toHaveBeenCalled();
  });

  it("activates the project when its name is clicked", async () => {
    mockBackend();
    const onArchScope = vi.fn();
    renderTree({ onArchScope });
    await expandRow("ACME");
    await expandRow("apps");
    expect(await screen.findByText("NestJS")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "be" }));
    expect(onArchScope).toHaveBeenCalledWith({ kind: "project", rootId: "r1", rel: "apps/be" });
    // Activating never expands by itself.
    expect(screen.queryByText("nest-cli.json")).toBeNull();
  });

  it("selects plain folders for exploring without touching the scope", async () => {
    mockBackend();
    const onArchScope = vi.fn();
    const onSelectFolder = vi.fn();
    renderTree({ onArchScope, onSelectFolder });
    await expandRow("ACME");
    expect(await screen.findByText("docs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "docs" }));
    expect(onSelectFolder).toHaveBeenCalledWith("r1", "docs");
    expect(onArchScope).not.toHaveBeenCalled();
  });

  it("analyzes an explicit folder from its menu", async () => {
    mockBackend();
    const onAnalyzeFolder = vi.fn();
    renderTree({ onAnalyzeFolder });
    await expandRow("ACME");
    const row = (await screen.findByText("docs")).closest("li") ?? document.body;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Options for docs" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Analyze this folder" }));
    expect(onAnalyzeFolder).toHaveBeenCalledWith("r1", "docs");
  });

  it("toggles project visibility without touching scope or files", async () => {
    mockBackend();
    const onToggleMapProject = vi.fn();
    const onArchScope = vi.fn();
    const onOpenFile = vi.fn();
    renderTree({ onToggleMapProject, onArchScope, onOpenFile });
    await expandRow("ACME");
    await expandRow("apps");
    const eye = await screen.findByRole("button", { name: "Hide fe from architecture" });
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    expect(eye.getAttribute("title")).toBe("Hide from architecture");
    fireEvent.click(eye);
    expect(onToggleMapProject).toHaveBeenCalledWith("r1::apps/fe");
    expect(onArchScope).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
    // The click never propagates to the row (nothing expands).
    expect(screen.queryByText("angular.json")).toBeNull();
  });

  it("shows no eye on plain folders", async () => {
    mockBackend();
    renderTree({ onToggleMapProject: () => {} });
    await expandRow("ACME");
    const row = (await screen.findByText("docs")).closest("li") ?? document.body;
    expect(
      within(row as HTMLElement).queryByRole("button", { name: /architecture/ }),
    ).toBeNull();
  });

  it("marks the active project row", async () => {
    mockBackend();
    renderTree({ archScope: { kind: "project", rootId: "r1", rel: "apps/be" } });
    await expandRow("ACME");
    await expandRow("apps");
    const name = await screen.findByRole("button", { name: "be" });
    expect(name.getAttribute("aria-current")).toBe("true");
  });

  it("opening a file keeps the active project", async () => {
    mockBackend();
    const onArchScope = vi.fn();
    const onOpenFile = vi.fn();
    renderTree({
      archScope: { kind: "project", rootId: "r1", rel: "apps/be" },
      onArchScope,
      onOpenFile,
    });
    await expandRow("ACME");
    await expandRow("apps");
    await expandRow("be");
    expect(await screen.findByText("nest-cli.json")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "nest-cli.json" }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onArchScope).not.toHaveBeenCalled();
  });
});
