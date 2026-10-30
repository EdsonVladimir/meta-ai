// @vitest-environment jsdom
// Tree refresh after accepting code: the given folder reloads and
// shows new files without losing the expansion.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeTree } from "./CodeTree";
import { clearDiscoveryCache } from "./detectProjects";
import type { CodeEntryDto, CodeRootDto } from "./types";

const { mockListCodeDir } = vi.hoisted(() => ({ mockListCodeDir: vi.fn() }));

vi.mock("./client", () => ({
  listCodeDir: mockListCodeDir,
  readCodeFile: vi.fn(async () => ({ text: "", fingerprint: "h", size: 0 })),
  normalizeCodeError: (raw: unknown) =>
    raw instanceof Error ? { kind: "unknown", message: raw.message } : { kind: "unknown", message: "?" },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockListCodeDir.mockReset();
  clearDiscoveryCache();
});

function root(): CodeRootDto {
  return { id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: null };
}

function file(name: string): CodeEntryDto {
  return { name, rel: name, kind: "file", size: 10 };
}

function renderTree(refresh: { rootId: string; dir: string; nonce: number } | null = null) {
  return render(
    <CodeTree
      roots={[root()]}
      loading={false}
      error={null}
      onRetry={() => {}}
      onAddRoot={() => {}}
      adding={false}
      onRemoveRoot={() => {}}
      onOpenFile={() => {}}
      onTerminalAt={() => {}}
      refresh={refresh}
    />,
  );
}

describe("tree refresh", () => {
  it("reloads the given folder and keeps the expansion", async () => {
    let phase = 0;
    mockListCodeDir.mockImplementation(async () =>
      phase === 0
        ? { entries: [file("a.ts")], truncated: false }
        : { entries: [file("a.ts"), file("b.ts")], truncated: false },
    );
    const { rerender } = renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Expand frontend" }));
    expect(await screen.findByText("a.ts")).toBeDefined();
    phase = 1;
    rerender(
      <CodeTree
        roots={[root()]}
        loading={false}
        error={null}
        onRetry={() => {}}
        onAddRoot={() => {}}
        adding={false}
        onRemoveRoot={() => {}}
        onOpenFile={() => {}}
        onTerminalAt={() => {}}
        refresh={{ rootId: "root-1", dir: "", nonce: 1 }}
      />,
    );
    expect(await screen.findByText("b.ts")).toBeDefined();
    expect(screen.getByText("a.ts")).toBeDefined();
    // Discovery pass + expand + refresh reload.
    expect(mockListCodeDir).toHaveBeenCalledTimes(3);
    expect(mockListCodeDir).toHaveBeenLastCalledWith("root-1", "");
  });

  it("the name goes in a flexible label with a full tooltip", async () => {
    mockListCodeDir.mockImplementation(async (_rootId: string, rel: string) =>
      rel === ""
        ? { entries: [{ name: "auditoria", rel: "auditoria", kind: "dir", size: 0 }], truncated: false }
        : { entries: [], truncated: false },
    );
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Expand frontend" }));
    const label = await screen.findByText("auditoria");
    expect(label.classList.contains("code-label")).toBe(true);
    const button = label.closest("button");
    expect(button?.getAttribute("title")).toBe("auditoria");
    const row = label.closest(".code-row");
    expect(row?.querySelector(".code-chevron-button")).not.toBeNull();
  });

  it("without refresh it does not reload extra", async () => {
    mockListCodeDir.mockResolvedValue({ entries: [file("a.ts")], truncated: false });
    const { rerender } = renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Expand frontend" }));
    expect(await screen.findByText("a.ts")).toBeDefined();
    rerender(
      <CodeTree
        roots={[root()]}
        loading={false}
        error={null}
        onRetry={() => {}}
        onAddRoot={() => {}}
        adding={false}
        onRemoveRoot={() => {}}
        onOpenFile={() => {}}
        onTerminalAt={() => {}}
        refresh={null}
      />,
    );
    // Discovery pass + expand; the rerender without refresh adds nothing.
    expect(mockListCodeDir).toHaveBeenCalledTimes(2);
  });
});
