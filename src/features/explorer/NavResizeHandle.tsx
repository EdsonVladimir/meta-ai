// Shared side-width handle (mouse or keyboard). It lives in .nav-slot,
// outside the scrolling navs: inside, overflow would clip what sticks
// out and the classic bar would cover it when expanding long lists. All
// views share the same column and the same persisted width. Null
// restores the CSS default.
import { useCallback, useRef } from "react";
import {
  DEFAULT_NAV_WIDTH,
  MAX_NAV_WIDTH,
  MIN_NAV_WIDTH,
  RESIZE_KEYBOARD_STEP_PX,
  useRequirementsUi,
} from "../requirements/uiStore";

export function NavResizeHandle() {
  const width = useRequirementsUi((s) => s.navigatorWidth);
  const draggingRef = useRef(false);

  const apply = useCallback((clientX: number, baseX: number, baseWidth: number) => {
    const next = Math.min(MAX_NAV_WIDTH, Math.max(MIN_NAV_WIDTH, baseWidth + clientX - baseX));
    useRequirementsUi.getState().setNavigatorWidth(next);
  }, []);

  return (
    <div
      className="nav-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Adjust the navigator width"
      aria-valuenow={width ?? undefined}
      aria-valuemin={MIN_NAV_WIDTH}
      aria-valuemax={MAX_NAV_WIDTH}
      tabIndex={0}
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const baseX = e.clientX;
        // The slot measures the same as the visible nav (no own borders
        // or padding): it is the grid column.
        const slot = (e.target as HTMLElement).closest(".nav-slot");
        const baseWidth = slot?.getBoundingClientRect().width ?? MIN_NAV_WIDTH;
        const move = (ev: PointerEvent) => {
          if (draggingRef.current) apply(ev.clientX, baseX, baseWidth);
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
        const current = useRequirementsUi.getState().navigatorWidth ?? DEFAULT_NAV_WIDTH;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const delta = e.key === "ArrowRight" ? RESIZE_KEYBOARD_STEP_PX : -RESIZE_KEYBOARD_STEP_PX;
          useRequirementsUi
            .getState()
            .setNavigatorWidth(
              Math.min(MAX_NAV_WIDTH, Math.max(MIN_NAV_WIDTH, current + delta)),
            );
        } else if (e.key === "Home") {
          e.preventDefault();
          useRequirementsUi.getState().setNavigatorWidth(null);
        }
      }}
    />
  );
}
