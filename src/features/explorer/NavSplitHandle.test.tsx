// @vitest-environment jsdom
// Projects/Folders split: dragging and keyboard over the persisted share.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NavSplitHandle } from "./NavSplitHandle";
import {
  DEFAULT_PROJECTS_PANE_FRAC,
  MAX_PROJECTS_PANE_FRAC,
  MIN_PROJECTS_PANE_FRAC,
  useRequirementsUi,
} from "../requirements/uiStore";

afterEach(() => {
  cleanup();
  useRequirementsUi.setState({ projectsPaneFrac: null });
});

const name = "Adjust the height of Projects and Folders";

describe("NavSplitHandle", () => {
  it("arrows adjust from the default and Home restores", () => {
    render(<NavSplitHandle />);
    const handle = screen.getByRole("separator", { name });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(useRequirementsUi.getState().projectsPaneFrac).toBeCloseTo(
      DEFAULT_PROJECTS_PANE_FRAC + 0.05,
    );
    fireEvent.keyDown(handle, { key: "Home" });
    expect(useRequirementsUi.getState().projectsPaneFrac).toBeNull();
  });

  it("dragging follows the pointer inside the limits", () => {
    const { container } = render(
      <div className="nav-slot">
        <NavSplitHandle />
      </div>,
    );
    const slot = container.querySelector(".nav-slot") as HTMLElement;
    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 800,
    } as DOMRect);
    fireEvent.pointerDown(screen.getByRole("separator", { name }));
    fireEvent.pointerMove(window, { clientY: 500 });
    expect(useRequirementsUi.getState().projectsPaneFrac).toBeCloseTo(0.5);
    fireEvent.pointerMove(window, { clientY: 0 });
    expect(useRequirementsUi.getState().projectsPaneFrac).toBe(MIN_PROJECTS_PANE_FRAC);
    fireEvent.pointerMove(window, { clientY: 5000 });
    expect(useRequirementsUi.getState().projectsPaneFrac).toBe(MAX_PROJECTS_PANE_FRAC);
    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientY: 500 });
    expect(useRequirementsUi.getState().projectsPaneFrac).toBe(MAX_PROJECTS_PANE_FRAC);
  });
});
