// Height split between Projects and Folders (mouse or keyboard). A
// fraction of the column, so it holds when the window changes size.
// Null restores the CSS default.
import { useCallback, useRef } from "react";
import {
  DEFAULT_PROJECTS_PANE_FRAC,
  MAX_PROJECTS_PANE_FRAC,
  MIN_PROJECTS_PANE_FRAC,
  RESIZE_KEYBOARD_STEP_FRAC,
  useRequirementsUi,
} from "../requirements/uiStore";

function clamp(frac: number): number {
  return Math.min(MAX_PROJECTS_PANE_FRAC, Math.max(MIN_PROJECTS_PANE_FRAC, frac));
}

export function NavSplitHandle() {
  const frac = useRequirementsUi((s) => s.projectsPaneFrac);
  const draggingRef = useRef(false);

  const apply = useCallback((clientY: number, slot: DOMRect) => {
    if (slot.height <= 0) return;
    useRequirementsUi.getState().setProjectsPaneFrac(clamp((clientY - slot.top) / slot.height));
  }, []);

  return (
    <div
      className="nav-split"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Adjust the height of Projects and Folders"
      aria-valuenow={Math.round((frac ?? DEFAULT_PROJECTS_PANE_FRAC) * 100)}
      aria-valuemin={Math.round(MIN_PROJECTS_PANE_FRAC * 100)}
      aria-valuemax={Math.round(MAX_PROJECTS_PANE_FRAC * 100)}
      tabIndex={0}
      onPointerDown={(e) => {
        const slot = (e.target as HTMLElement).closest(".nav-slot")?.getBoundingClientRect();
        if (slot === undefined) return;
        e.preventDefault();
        draggingRef.current = true;
        const move = (ev: PointerEvent) => {
          if (draggingRef.current) apply(ev.clientY, slot);
        };
        const up = () => {
          draggingRef.current = false;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onKeyDown={(e) => {
        const ui = useRequirementsUi.getState();
        const current = ui.projectsPaneFrac ?? DEFAULT_PROJECTS_PANE_FRAC;
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? RESIZE_KEYBOARD_STEP_FRAC : -RESIZE_KEYBOARD_STEP_FRAC;
          ui.setProjectsPaneFrac(clamp(current + delta));
        } else if (e.key === "Home") {
          e.preventDefault();
          ui.setProjectsPaneFrac(null);
        }
      }}
    />
  );
}
