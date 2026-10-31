// @vitest-environment jsdom
// Roots registered outside the panel reach Folders with no second pick.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRequirementsUi } from "../requirements/uiStore";
import { CodeWorkspaceProvider, useCodeWorkspace } from "./useCodeWorkspace";

const mocks = vi.hoisted(() => ({ roots: [] as Array<Record<string, unknown>> }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "code_list_roots") return mocks.roots;
    return command.includes("list") ? [] : null;
  }),
}));
vi.mock("../../lib/env", () => ({ isTauriEnvironment: () => true }));

function Roots() {
  const { roots, rootsLoading } = useCodeWorkspace();
  return (
    <p>
      {roots.map((root) => root.name).join(",") || "none"}
      {rootsLoading ? " loading" : ""}
    </p>
  );
}

afterEach(() => {
  cleanup();
  mocks.roots = [];
});

describe("workspace roots", () => {
  it("shows a project's folder as soon as it is registered, without flicker", async () => {
    render(
      <CodeWorkspaceProvider>
        <Roots />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("none");
    mocks.roots = [
      { id: "root-1", path: "/x/reservas", name: "reservas", missing: false, projectId: "p1", aiBlocked: false },
    ];
    act(() => useRequirementsUi.getState().bumpCodeLibrary());
    expect(screen.queryByText(/loading/)).toBeNull();
    await waitFor(() => expect(screen.getByText("reservas")).toBeTruthy());
  });

  it("reads the list once per change", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    render(
      <CodeWorkspaceProvider>
        <Roots />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("none");
    const calls = () =>
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "code_list_roots").length;
    const before = calls();
    act(() => useRequirementsUi.getState().bumpCodeLibrary());
    await waitFor(() => expect(calls()).toBe(before + 1));
    act(() => useRequirementsUi.getState().setArchInspectorCollapsed(false));
    expect(calls()).toBe(before + 1);
  });
});
