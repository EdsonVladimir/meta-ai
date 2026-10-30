// Board viewport: the scrollable canvas frame. The wheel zooms around
// the cursor, dragging the background pans, and a discreet floating
// cluster (-/percent/+/Fit) drives the shared zoom without taking
// toolbar space. Without a zoom setter the wheel keeps scrolling
// natively (no dead controls).
import { useEffect, useRef, type ReactNode } from "react";
import { anchoredScroll, fitZoomStep } from "./boardLayout";
import { boardZoomPercent, BOARD_ZOOM_STEPS, stepBoardZoom } from "./boardZoom";

interface BoardViewportProps {
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  /** Accessible region name, e.g. which diagram this frames. */
  label: string;
  /** Canvas size from the layout pass (for Fit, no measuring). */
  canvasWidth: number;
  canvasHeight: number;
  /** Fits the canvas when mounted, so a whole chain opens on screen. */
  fitOnEntry?: boolean;
  children: ReactNode;
}

interface Anchor {
  cursorX: number;
  cursorY: number;
  prevZoom: number;
}

export function BoardViewport({
  zoom,
  onZoomChange,
  label,
  canvasWidth,
  canvasHeight,
  fitOnEntry = false,
  children,
}: BoardViewportProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const changeRef = useRef(onZoomChange);
  changeRef.current = onZoomChange;
  const anchorRef = useRef<Anchor | null>(null);

  // Cursor-anchored wheel zoom (native listener: React wheel handlers
  // cannot preventDefault the scroll).
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null || changeRef.current === undefined) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      anchorRef.current = {
        cursorX: event.clientX - rect.left,
        cursorY: event.clientY - rect.top,
        prevZoom: zoomRef.current,
      };
      changeRef.current?.(stepBoardZoom(zoomRef.current, event.deltaY > 0 ? -1 : 1));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  // Apply the pending anchor once the zoom lands.
  useEffect(() => {
    const anchor = anchorRef.current;
    const node = scrollRef.current;
    anchorRef.current = null;
    if (anchor === null || node === null) return;
    node.scrollLeft = anchoredScroll(anchor.prevZoom, zoom, node.scrollLeft, anchor.cursorX);
    node.scrollTop = anchoredScroll(anchor.prevZoom, zoom, node.scrollTop, anchor.cursorY);
  }, [zoom]);

  function fit(): void {
    const node = scrollRef.current;
    if (node === null) return;
    changeRef.current?.(
      fitZoomStep(canvasWidth, canvasHeight, node.clientWidth, node.clientHeight),
    );
    node.scrollLeft = 0;
    node.scrollTop = 0;
  }

  useEffect(() => {
    if (fitOnEntry) fit();
    // Once per mount: later changes keep the person's own zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function panFrom(event: React.MouseEvent): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, .archboard-card") !== null) return;
    const node = scrollRef.current;
    if (node === null) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = node.scrollLeft;
    const startTop = node.scrollTop;
    node.classList.add("panning");
    const onMove = (move: MouseEvent) => {
      node.scrollLeft = startLeft - (move.clientX - startX);
      node.scrollTop = startTop - (move.clientY - startY);
    };
    const onUp = () => {
      node.classList.remove("panning");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="board-viewport-wrap">
      <div
        ref={scrollRef}
        className="board-viewport"
        role="region"
        aria-label={label}
        tabIndex={0}
        onMouseDown={panFrom}
      >
        <div className="archmap-zoom" style={{ zoom }}>
          {children}
        </div>
      </div>
      {onZoomChange !== undefined && (
        <div className="board-zoom-float" role="group" aria-label="Board zoom">
          <button
            type="button"
            className="secondary small"
            onClick={() => changeRef.current?.(stepBoardZoom(zoomRef.current, -1))}
            disabled={zoom <= BOARD_ZOOM_STEPS[0]}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => changeRef.current?.(1)}
            aria-label={`Reset zoom (currently ${boardZoomPercent(zoom)} percent)`}
            title="Reset zoom to 100%"
          >
            {boardZoomPercent(zoom)}%
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => changeRef.current?.(stepBoardZoom(zoomRef.current, 1))}
            disabled={zoom >= BOARD_ZOOM_STEPS[BOARD_ZOOM_STEPS.length - 1]}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="secondary small board-fit"
            onClick={fit}
            title="Fit the board to the view"
          >
            Fit
          </button>
        </div>
      )}
    </div>
  );
}
