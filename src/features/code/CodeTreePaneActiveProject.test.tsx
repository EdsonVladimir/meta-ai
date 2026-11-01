// @vitest-environment jsdom
// Folders shows only the roots bound to the active project: other
// projects' folders and loose folders stay hidden (flags untouched,
// still enforced in the backend).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EMPTY_SELECTION, useRequirementsUi } from "../requirements/uiStore";
import { CodeWorkspaceProvider } from "./useCodeWorkspace";
import { CodeTreePane } from "./CodeTreePane";
import { clearDiscoveryCache } from "./detectProjects";
import type { CodeRootDto } from "./types";

const backend = vi.hoisted(() => ({
  roots: [] as CodeRootDto[],
  projects: [] as Array<{ id: string; name: string }>,
  dialogPath: null as string | null,
  setCalls: [] as Array<{ rootId: string; projectId: string | null }>,
  tree: {} as Record<string, { entries: Array<{ name: string; rel: string; kind: "dir" | "file"; size: number | null }>; truncated: boolean }>,
}));

function root(overrides: Partial<CodeRootDto> = {}): CodeRootDto {
  return {
    id: "root-1",
    path: "/x/shop",
    name: "shop",
    missing: false,
    projectId: "proy-1",
    aiBlocked: false,
    ...overrides,
  };
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: { input?: unknown }) => {
    if (cmd === "code_list_roots") return [...backend.roots];
    if (cmd === "core_list_projects") return [...backend.projects];
    if (cmd === "code_list_dir") {
      const input = args?.input as { rootId: string; rel: string };
      return backend.tree[`${input.rootId}::${input.rel}`] ?? { entries: [], truncated: false };
    }
    if (cmd === "code_read_file") {
      const input = args?.input as { rel: string };
      return {
        text: input.rel.endsWith("package.json") ? `{"name":"${input.rel}"}` : "",
        fingerprint: "h",
        size: 10,
      };
    }
    if (cmd === "code_set_root_project") {
      const input = args?.input as { rootId: string; projectId: string | null };
      backend.setCalls.push(input);
      const found = backend.roots.find((entry) => entry.id === input.rootId);
      if (found === undefined) throw { kind: "missing", message: "no root" };
      backend.roots = backend.roots.map((entry) =>
        entry.id === input.rootId ? { ...entry, projectId: input.projectId } : entry,
      );
      return { ...found, projectId: input.projectId };
    }
    throw { kind: "unknown", message: `Unsimulated command: ${cmd}` };
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => backend.dialogPath),
}));
vi.mock("../../lib/env", () => ({ isTauriEnvironment: () => true }));

beforeEach(() => {
  clearDiscoveryCache();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  backend.roots = [];
  backend.projects = [];
  backend.dialogPath = null;
  backend.setCalls = [];
  backend.tree = {};
  useRequirementsUi.setState({
    selection: { ...EMPTY_SELECTION },
    archScope: { kind: "all" },
    mapHiddenProjects: {},
    mapOpenedProjects: {},
  });
});

describe("CodeTreePane under one active project", () => {
  it("shows the active project's folders and hides every other root", async () => {
    backend.roots = [
      root({ id: "root-1", name: "shop", projectId: "proy-1" }),
      root({ id: "root-2", name: "blog", projectId: "proy-2" }),
      root({ id: "root-3", name: "loose", projectId: null }),
    ];
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("shop");
    expect(screen.queryByText("blog")).toBeNull();
    expect(screen.queryByText("loose")).toBeNull();
  });

  it("switching projects swaps the visible folders", async () => {
    backend.roots = [
      root({ id: "root-1", name: "shop", projectId: "proy-1" }),
      root({ id: "root-2", name: "blog", projectId: "proy-2" }),
    ];
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("shop");
    cleanup();
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-2" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("blog");
    expect(screen.queryByText("shop")).toBeNull();
  });

  it("names the other project when the picked folder belongs to it", async () => {
    backend.roots = [
      root({ id: "root-1", name: "shop", path: "/x/shop", projectId: "proy-1" }),
      root({ id: "root-2", name: "blog", path: "/x/blog", projectId: "proy-2" }),
    ];
    backend.projects = [
      { id: "proy-1", name: "Shop" },
      { id: "proy-2", name: "Blog" },
    ];
    backend.dialogPath = "/x/blog";
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("shop");
    fireEvent.click(screen.getByRole("button", { name: "+ Add folder" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Move folder to this project" });
    expect(within(dialog).getByText(/already belongs to project/)).toBeTruthy();
    expect(within(dialog).getByText(/Blog/)).toBeTruthy();
    expect(backend.setCalls).toEqual([]);
    // Cancelling changes nothing: no link call, the dialog closes.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Move folder to this project" })).toBeNull(),
    );
    expect(backend.setCalls).toEqual([]);
    expect(screen.queryByText("blog")).toBeNull();
  });

  it("confirming the move binds the folder to the active project", async () => {
    backend.roots = [
      root({ id: "root-1", name: "shop", path: "/x/shop", projectId: "proy-1" }),
      root({ id: "root-2", name: "blog", path: "/x/blog", projectId: "proy-2" }),
    ];
    backend.projects = [{ id: "proy-2", name: "Blog" }];
    backend.dialogPath = "/x/blog";
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("shop");
    fireEvent.click(screen.getByRole("button", { name: "+ Add folder" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Move folder to this project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here" }));
    await waitFor(() =>
      expect(backend.setCalls).toEqual([{ rootId: "root-2", projectId: "proy-1" }]),
    );
    await screen.findByText("blog");
  });

  it("focuses a service on name click: eye opens, recorded, board narrows", async () => {
    backend.roots = [root({ id: "root-1", name: "shop", path: "/x/shop", projectId: "proy-1" })];
    const apps = ["fe", "be", "billing", "auth"];
    const entry = (name: string, rel: string, kind: "dir" | "file") => ({ name, rel, kind, size: 10 as const });
    backend.tree = {
      "root-1::": { entries: [entry("apps", "apps", "dir")], truncated: false },
      "root-1::apps": {
        entries: apps.map((name) => entry(name, `apps/${name}`, "dir")),
        truncated: false,
      },
    };
    for (const [index, name] of apps.entries()) {
      const manifest = index % 2 === 0 ? "angular.json" : "nest-cli.json";
      backend.tree[`root-1::apps/${name}`] = {
        entries: [entry("package.json", `apps/${name}/package.json`, "file"), entry(manifest, `apps/${name}/${manifest}`, "file")],
        truncated: false,
      };
    }
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("shop");
    fireEvent.click(screen.getByRole("button", { name: "Expand shop" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expand apps" }));
    // Four detected: the eye starts closed.
    const eye = await screen.findByRole("button", { name: "Show fe in architecture" });
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "fe" }));
    await waitFor(() =>
      expect(useRequirementsUi.getState().archScope).toEqual({
        kind: "project",
        rootId: "root-1",
        rel: "apps/fe",
      }),
    );
    expect(useRequirementsUi.getState().mapOpenedProjects).toEqual({ "root-1::apps/fe": true });
    expect(useRequirementsUi.getState().mapHiddenProjects).toEqual({ "root-1::apps/fe": false });
  });

  it("clicking the eye never changes the scope", async () => {
    backend.roots = [root({ id: "root-1", name: "shop", path: "/x/shop", projectId: "proy-1" })];
    const entry = (name: string, rel: string, kind: "dir" | "file") => ({ name, rel, kind, size: 10 as const });
    backend.tree = {
      "root-1::": { entries: [entry("apps", "apps", "dir")], truncated: false },
      "root-1::apps": { entries: [entry("fe", "apps/fe", "dir")], truncated: false },
      "root-1::apps/fe": {
        entries: [entry("package.json", "apps/fe/package.json", "file"), entry("angular.json", "apps/fe/angular.json", "file")],
        truncated: false,
      },
    };
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("shop");
    fireEvent.click(screen.getByRole("button", { name: "Expand shop" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expand apps" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hide fe from architecture" }));
    await waitFor(() =>
      expect(useRequirementsUi.getState().mapHiddenProjects).toEqual({ "root-1::apps/fe": true }),
    );
    expect(useRequirementsUi.getState().archScope).toEqual({ kind: "all" });
    expect(useRequirementsUi.getState().mapOpenedProjects).toEqual({});
  });

  it("keeps the Never send to Muse mark on a visible blocked root", async () => {
    backend.roots = [root({ id: "root-1", name: "shop", projectId: "proy-1", aiBlocked: true })];
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    render(
      <CodeWorkspaceProvider>
        <CodeTreePane />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("shop");
    fireEvent.click(screen.getByRole("button", { name: "Options for shop" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByRole("menuitem", { name: "Allow sending to Muse" })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Ask Muse" }).hasAttribute("disabled")).toBe(true);
  });
});
