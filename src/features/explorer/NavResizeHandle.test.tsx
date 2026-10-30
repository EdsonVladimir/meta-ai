// @vitest-environment jsdom
// Shared navigator handle: keyboard (arrows/Home) over the persisted
// width. Mouse dragging trusts the same apply.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NavResizeHandle } from "./NavResizeHandle";
import { DEFAULT_NAV_WIDTH, useRequirementsUi } from "../requirements/uiStore";

beforeEach(() => {
  useRequirementsUi.setState({ navigatorWidth: null });
});

afterEach(() => {
  cleanup();
  useRequirementsUi.setState({ navigatorWidth: null });
});

describe("NavResizeHandle", () => {
  it("arrows adjust from the default and Home restores", () => {
    render(<NavResizeHandle />);
    const handle = screen.getByRole("separator", { name: "Adjust the navigator width" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(useRequirementsUi.getState().navigatorWidth).toBe(DEFAULT_NAV_WIDTH + 16);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(useRequirementsUi.getState().navigatorWidth).toBe(DEFAULT_NAV_WIDTH);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(useRequirementsUi.getState().navigatorWidth).toBeNull();
  });

  it("dragging measures the slot, not the nav", () => {
    // The handle is the slot's child (sibling of the visible nav):
    // measuring the nearest nav would fail when moved out of the scroll.
    const { container } = render(
      <div className="nav-slot">
        <nav aria-label="x" />
        <NavResizeHandle />
      </div>,
    );
    const slot = container.querySelector(".nav-slot") as HTMLElement;
    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 800,
      top: 0,
      left: 0,
      bottom: 800,
      right: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("separator", { name: "Adjust the navigator width" });
    (handle as HTMLElement).setPointerCapture = vi.fn();
    try {
      fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, bubbles: true });
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 520, bubbles: true }));
      expect(useRequirementsUi.getState().navigatorWidth).toBe(320);
    } finally {
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    }
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600, bubbles: true }));
    expect(useRequirementsUi.getState().navigatorWidth).toBe(320);
  });

  it("respeta los topes", () => {
    useRequirementsUi.setState({ navigatorWidth: 519 });
    render(<NavResizeHandle />);
    const handle = screen.getByRole("separator", { name: "Adjust the navigator width" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(useRequirementsUi.getState().navigatorWidth).toBe(520);
  });
});
