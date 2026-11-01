// @vitest-environment jsdom
// Single active project in the code session: closing the workspace
// closes every tab and clears the scope; removals are reported;
// added folders join the active project; replications switch through
// the workspace instead of jumping on their own.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMPTY_SELECTION, useRequirementsUi } from "../requirements/uiStore";
import { CodeWorkspaceProvider, useCodeWorkspace } from "./useCodeWorkspace";
import type { CodeRootDto, CodeTab, ReplicateResultDto } from "./types";

const backend = vi.hoisted(() => ({
  roots: [] as CodeRootDto[],
  dialogPath: null as string | null,
  setProjectImpl: null as null | ((rootId: string, projectId: string | null) => unknown),
  calls: [] as Array<{ cmd: string; input: unknown }>,
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

function tab(overrides: Partial<CodeTab> = {}): CodeTab {
  return {
    rootId: "root-1",
    rootName: "shop",
    rel: "a.ts",
    name: "a.ts",
    content: { text: "x", fingerprint: "f", size: 1 },
    error: null,
    loading: false,
    savedText: "x",
    dirty: false,
    saving: false,
    saveError: null,
    language: "typescript",
    ...overrides,
  };
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: { input?: unknown }) => {
    backend.calls.push({ cmd, input: args?.input });
    if (cmd === "code_list_roots") return [...backend.roots];
    if (cmd === "code_add_root") {
      const input = args?.input as { path: string };
      return root({ id: "root-9", path: input.path, name: "added", projectId: null });
    }
    if (cmd === "code_set_root_project") {
      if (backend.setProjectImpl === null) throw { kind: "unmocked", message: "no impl" };
      const input = args?.input as { rootId: string; projectId: string | null };
      return backend.setProjectImpl(input.rootId, input.projectId);
    }
    if (cmd === "code_remove_root") {
      const input = args?.input as { rootId: string };
      return root({ id: input.rootId });
    }
    if (cmd === "core_list_projects") return [];
    throw { kind: "unknown", message: `Unsimulated command: ${cmd}` };
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => backend.dialogPath),
}));
vi.mock("../../lib/env", () => ({ isTauriEnvironment: () => true }));

function Probe() {
  const state = useCodeWorkspace();
  return (
    <div>
      <p data-testid="tabs">{state.tabs.map((entry) => `${entry.rootId}:${entry.rel}`).join(",")}</p>
      <p data-testid="scope">{state.scope.map((file) => `${file.rootId}:${file.rel}`).join(",")}</p>
      <p data-testid="roots">
        {state.roots.map((entry) => `${entry.id}@${entry.projectId ?? "-"}`).join(",")}
      </p>
      <p data-testid="addError">{state.addError ?? ""}</p>
      <p data-testid="addConfirm">
        {state.addConfirm === null
          ? ""
          : `${state.addConfirm.root.id}@${state.addConfirm.fromProjectId}`}
      </p>
      <p data-testid="loading">{state.rootsLoading ? "yes" : "no"}</p>
      <button type="button" onClick={() => state.setTabs([tab({}), tab({ rootId: "root-2", rel: "b.ts", name: "b.ts" })])}>
        seed tabs
      </button>
      <button
        type="button"
        onClick={() => state.setScope([{ rootId: "root-1", rel: "a.ts" }])}
      >
        seed scope
      </button>
      <button type="button" onClick={() => void state.handleAddRoot()}>
        add folder
      </button>
      <button type="button" onClick={() => void state.confirmAddFolder()}>
        confirm move
      </button>
      <button type="button" onClick={() => state.cancelAddFolder()}>
        cancel move
      </button>
      <button type="button" onClick={() => void state.doRemoveRoot(root({ id: "root-1" }))}>
        remove root-1
      </button>
      <button
        type="button"
        onClick={() =>
          state.handleReplicated({
            projectId: "proy-2",
            projectName: "Replica",
            projectCreated: true,
            modules: [{ moduleId: "mod-9", name: "m", rel: "m" }],
            alreadyLinked: [],
            root: root({ id: "root-1", projectId: "proy-2" }),
          } satisfies ReplicateResultDto)
        }
      >
        replicated
      </button>
    </div>
  );
}

function renderProvider(props: {
  onRootRemoved?: (found: CodeRootDto) => void;
  onRootAdded?: (found: CodeRootDto) => void;
  onReplicatedProject?: (projectId: string, moduleId: string | null, projectName: string) => void;
}) {
  render(
    <CodeWorkspaceProvider
      onRootRemoved={props.onRootRemoved}
      onRootAdded={props.onRootAdded}
      onReplicatedProject={props.onReplicatedProject}
    >
      <Probe />
    </CodeWorkspaceProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  backend.roots = [];
  backend.dialogPath = null;
  backend.setProjectImpl = null;
  backend.calls = [];
  useRequirementsUi.setState({
    selection: { ...EMPTY_SELECTION },
    codeTabsCloseSignal: 0,
    discardSignal: 0,
  });
});

describe("code session under one active project", () => {
  it("closes every tab and clears the scope when the workspace closes", async () => {
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "seed tabs" }));
    fireEvent.click(screen.getByRole("button", { name: "seed scope" }));
    expect(screen.getByTestId("tabs").textContent).toContain("root-1:a.ts");
    expect(screen.getByTestId("scope").textContent).toContain("root-1:a.ts");
    act(() => useRequirementsUi.getState().requestCloseCodeTabs());
    await waitFor(() => expect(screen.getByTestId("tabs").textContent).toBe(""));
    expect(screen.getByTestId("scope").textContent).toBe("");
  });

  it("drops the roots and reloads them when the workspace closes", async () => {
    backend.roots = [root({ id: "root-1", projectId: "proy-1" })];
    renderProvider({});
    await waitFor(() =>
      expect(screen.getByTestId("roots").textContent).toContain("root-1@proy-1"),
    );
    expect(screen.getByTestId("loading").textContent).toBe("no");
    act(() => useRequirementsUi.getState().requestCloseCodeTabs());
    await waitFor(() => expect(screen.getByTestId("roots").textContent).toBe(""));
    // No view may render the stale list while the next load runs.
    expect(screen.getByTestId("loading").textContent).toBe("yes");
  });

  it("reports a removed root so the workspace can update recents and close", async () => {
    const onRootRemoved = vi.fn();
    renderProvider({ onRootRemoved });
    fireEvent.click(screen.getByRole("button", { name: "remove root-1" }));
    await waitFor(() => expect(onRootRemoved).toHaveBeenCalledTimes(1));
    expect(onRootRemoved).toHaveBeenCalledWith(expect.objectContaining({ id: "root-1" }));
  });

  it("binds an added folder to the active project", async () => {
    backend.dialogPath = "/x/new";
    backend.setProjectImpl = (rootId, projectId) =>
      root({ id: rootId, projectId, name: "added" });
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() =>
      expect(screen.getByTestId("roots").textContent).toContain("root-9@proy-1"),
    );
    expect(
      backend.calls.some(
        (call) =>
          call.cmd === "code_set_root_project" &&
          (call.input as { projectId: string }).projectId === "proy-1",
      ),
    ).toBe(true);
    expect(screen.getByTestId("addError").textContent).toBe("");
  });

  it("adds a loose folder when no project is active", async () => {
    backend.dialogPath = "/x/loose";
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() =>
      expect(screen.getByTestId("roots").textContent).toContain("root-9@-"),
    );
    expect(backend.calls.some((call) => call.cmd === "code_set_root_project")).toBe(false);
  });

  it("drops the just-added folder when binding fails, instead of hiding it loose", async () => {
    backend.dialogPath = "/x/new";
    backend.setProjectImpl = () => {
      throw { kind: "link_failed", message: "nope" };
    };
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() =>
      expect(screen.getByTestId("addError").textContent).toContain("Could not add the folder"),
    );
    expect(screen.getByTestId("roots").textContent).not.toContain("root-9");
    expect(backend.calls.some((call) => call.cmd === "code_remove_root")).toBe(true);
  });

  it("binds a known loose folder directly without asking", async () => {
    backend.roots = [root({ id: "root-9", path: "/x/loose", projectId: null })];
    backend.dialogPath = "/x/loose";
    backend.setProjectImpl = (rootId, projectId) =>
      root({ id: rootId, path: "/x/loose", projectId });
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() =>
      expect(screen.getByTestId("roots").textContent).toContain("root-9@proy-1"),
    );
    expect(screen.getByTestId("addConfirm").textContent).toBe("");
    expect(backend.calls.some((call) => call.cmd === "code_add_root")).toBe(false);
  });

  it("changes nothing when the folder is already in this project", async () => {
    backend.roots = [root({ id: "root-1", path: "/x/shop", projectId: "proy-1" })];
    backend.dialogPath = "/x/shop";
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() =>
      expect(screen.getByTestId("roots").textContent).toContain("root-1@proy-1"),
    );
    expect(backend.calls.some((call) => call.cmd === "code_set_root_project")).toBe(false);
    expect(backend.calls.some((call) => call.cmd === "code_add_root")).toBe(false);
    expect(screen.getByTestId("addConfirm").textContent).toBe("");
  });

  it("asks before moving a folder that belongs to another project", async () => {
    backend.roots = [root({ id: "root-2", path: "/x/blog", projectId: "proy-2" })];
    backend.dialogPath = "/x/blog";
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() => expect(screen.getByTestId("addConfirm").textContent).toBe("root-2@proy-2"));
    expect(backend.calls.some((call) => call.cmd === "code_set_root_project")).toBe(false);
  });

  it("confirming the move rebinds the folder and reports it", async () => {
    backend.roots = [root({ id: "root-2", path: "/x/blog", projectId: "proy-2" })];
    backend.dialogPath = "/x/blog";
    backend.setProjectImpl = (rootId, projectId) =>
      root({ id: rootId, path: "/x/blog", projectId });
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    const onRootAdded = vi.fn();
    renderProvider({ onRootAdded });
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() => expect(screen.getByTestId("addConfirm").textContent).toBe("root-2@proy-2"));
    fireEvent.click(screen.getByRole("button", { name: "confirm move" }));
    await waitFor(() =>
      expect(screen.getByTestId("roots").textContent).toContain("root-2@proy-1"),
    );
    expect(screen.getByTestId("addConfirm").textContent).toBe("");
    expect(onRootAdded).toHaveBeenCalledWith(expect.objectContaining({ id: "root-2" }));
  });

  it("cancelling the move changes nothing", async () => {
    backend.roots = [root({ id: "root-2", path: "/x/blog", projectId: "proy-2" })];
    backend.dialogPath = "/x/blog";
    useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION, projectId: "proy-1" } });
    renderProvider({});
    fireEvent.click(screen.getByRole("button", { name: "add folder" }));
    await waitFor(() => expect(screen.getByTestId("addConfirm").textContent).toBe("root-2@proy-2"));
    fireEvent.click(screen.getByRole("button", { name: "cancel move" }));
    await waitFor(() => expect(screen.getByTestId("addConfirm").textContent).toBe(""));
    expect(backend.calls.some((call) => call.cmd === "code_set_root_project")).toBe(false);
    expect(screen.getByTestId("roots").textContent).toContain("root-2@proy-2");
  });

  it("hands a replicated project to the workspace instead of switching alone", async () => {
    const onReplicatedProject = vi.fn();
    renderProvider({ onReplicatedProject });
    await screen.findByTestId("tabs");
    fireEvent.click(screen.getByRole("button", { name: "replicated" }));
    await waitFor(() =>
      expect(onReplicatedProject).toHaveBeenCalledWith("proy-2", "mod-9", "Replica"),
    );
    // The session no longer jumps on its own: selection waits for the gate.
    expect(useRequirementsUi.getState().selection.projectId).toBeNull();
  });
});
