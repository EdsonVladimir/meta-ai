// @vitest-environment jsdom
// Close guard: Rust learns about drafts, and a stopped close reaches the UI.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { allowCloseOnce, DRAFTS_CLOSE_EVENT, useCloseGuard } from "./closeGuard";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  listeners: new Map<string, () => void>(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: () => void) => {
    mocks.listeners.set(name, handler);
    return mocks.unlisten;
  }),
}));
vi.mock("../lib/env", () => ({ isTauriEnvironment: () => true }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.listeners.clear();
});

describe("useCloseGuard", () => {
  it("reports drafts only when they change", () => {
    const { rerender } = renderHook(({ dirty }) => useCloseGuard(dirty, () => {}), {
      initialProps: { dirty: false },
    });
    rerender({ dirty: true });
    rerender({ dirty: true });
    rerender({ dirty: false });
    expect(vi.mocked(mocks.invoke).mock.calls).toEqual([
      ["app_set_unsaved_drafts", { unsaved: false }],
      ["app_set_unsaved_drafts", { unsaved: true }],
      ["app_set_unsaved_drafts", { unsaved: false }],
    ]);
  });

  it("calls the newest handler when a close was stopped, then stops listening", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ fn }) => useCloseGuard(true, fn), {
      initialProps: { fn: first },
    });
    rerender({ fn: second });
    await waitFor(() => expect(mocks.listeners.has(DRAFTS_CLOSE_EVENT)).toBe(true));
    mocks.listeners.get(DRAFTS_CLOSE_EVENT)?.();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    unmount();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("asks Rust to let one close through", async () => {
    await allowCloseOnce();
    expect(mocks.invoke).toHaveBeenCalledWith("app_allow_close_once");
  });
});
