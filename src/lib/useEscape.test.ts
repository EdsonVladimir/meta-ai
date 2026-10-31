// @vitest-environment jsdom
// Esc cancels, except while a dialog must stay open.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { useEscape } from "./useEscape";

afterEach(() => cleanup());

describe("useEscape", () => {
  it("calls back on Esc only", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscape(onEscape));
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled, or after unmounting", () => {
    const onEscape = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useEscape(onEscape, on), {
      initialProps: { on: false },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
    rerender({ on: true });
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});
