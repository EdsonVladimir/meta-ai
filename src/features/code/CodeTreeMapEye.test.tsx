// @vitest-environment jsdom
// Eye toggle on tree roots: show/hide each diagram in the Map
// perspective. Optional props; without a handler no eye renders.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeTree } from "./CodeTree";
import type { CodeRootDto } from "./types";

vi.mock("./client", () => ({
  listCodeDir: vi.fn(async () => ({ entries: [], truncated: false })),
  normalizeCodeError: (raw: unknown) => ({ kind: "unknown", message: String(raw) }),
}));

afterEach(() => cleanup());

function root(): CodeRootDto {
  return { id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: "p1" };
}

function renderTree(options: {
  mapHidden?: Record<string, boolean>;
  onToggleMapRoot?: (rootId: string) => void;
}) {
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
      mapHidden={options.mapHidden}
      onToggleMapRoot={options.onToggleMapRoot}
    />,
  );
}

describe("root map eye", () => {
  it("toggles the diagram with pressed state and swapped icon", () => {
    const onToggleMapRoot = vi.fn();
    const { rerender } = renderTree({ mapHidden: {}, onToggleMapRoot });
    const eye = screen.getByRole("button", { name: "Hide the frontend diagram in Map" });
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    const openIcon = eye.innerHTML;
    fireEvent.click(eye);
    expect(onToggleMapRoot).toHaveBeenCalledWith("root-1");

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
        mapHidden={{ "root-1": true }}
        onToggleMapRoot={onToggleMapRoot}
      />,
    );
    const closed = screen.getByRole("button", { name: "Show the frontend diagram in Map" });
    expect(closed.getAttribute("aria-pressed")).toBe("false");
    expect(closed.innerHTML).not.toBe(openIcon);
  });

  it("renders no eye without a toggle handler", () => {
    renderTree({});
    expect(screen.queryByRole("button", { name: /diagram in Map/ })).toBeNull();
  });
});
