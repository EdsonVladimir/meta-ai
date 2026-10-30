// @vitest-environment jsdom
// Board viewport: wheel stepping, background panning, per-board Fit,
// and native scroll when no zoom setter is given.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BoardViewport } from "./BoardViewport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderViewport(options: {
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  canvasWidth?: number;
  canvasHeight?: number;
}) {
  return render(
    <BoardViewport
      zoom={options.zoom ?? 1}
      onZoomChange={options.onZoomChange}
      label="Diagram of backend"
      canvasWidth={options.canvasWidth ?? 1000}
      canvasHeight={options.canvasHeight ?? 800}
    >
      <div style={{ width: 1000, height: 800 }}>board</div>
    </BoardViewport>,
  );
}

function region(): HTMLElement {
  return screen.getByRole("region", { name: "Diagram of backend" });
}

describe("BoardViewport", () => {
  it("steps the shared zoom with the wheel", () => {
    const onZoomChange = vi.fn();
    renderViewport({ zoom: 1, onZoomChange });
    fireEvent.wheel(region(), { deltaY: -100, clientX: 60, clientY: 40 });
    expect(onZoomChange).toHaveBeenCalledWith(1.25);
    fireEvent.wheel(region(), { deltaY: 120, clientX: 60, clientY: 40 });
    expect(onZoomChange).toHaveBeenCalledWith(0.8);
  });

  it("keeps native scroll without a zoom setter", () => {
    const { container } = renderViewport({});
    fireEvent.wheel(region(), { deltaY: -100 });
    expect(screen.queryByRole("button", { name: "Fit" })).toBeNull();
    expect(container.querySelector(".archmap-zoom")?.getAttribute("style")).toContain("zoom: 1");
  });

  it("pans by dragging the background, never from cards", () => {
    renderViewport({ onZoomChange: () => {} });
    const node = region();
    node.scrollLeft = 100;
    node.scrollTop = 40;
    fireEvent.mouseDown(node, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 250, clientY: 180 });
    expect(node.scrollLeft).toBe(150);
    expect(node.scrollTop).toBe(60);
    fireEvent.mouseUp(window);

    const card = document.createElement("div");
    card.className = "archboard-card";
    node.appendChild(card);
    fireEvent.mouseDown(card, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    expect(node.scrollLeft).toBe(150);
    fireEvent.mouseUp(window);
  });

  it("fits the board to the view", () => {
    const onZoomChange = vi.fn();
    renderViewport({ zoom: 1, onZoomChange, canvasWidth: 1000, canvasHeight: 800 });
    const node = region();
    Object.defineProperty(node, "clientWidth", { value: 500, configurable: true });
    Object.defineProperty(node, "clientHeight", { value: 800, configurable: true });
    node.scrollLeft = 90;
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(onZoomChange).toHaveBeenCalledWith(0.5);
    expect(node.scrollLeft).toBe(0);
  });

  it("drives the shared zoom from a floating cluster", () => {
    const onZoomChange = vi.fn();
    renderViewport({ zoom: 1, onZoomChange });
    const group = screen.getByRole("group", { name: "Board zoom" });
    expect(group.className).toContain("board-zoom-float");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenCalledWith(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomChange).toHaveBeenCalledWith(0.8);
    fireEvent.click(screen.getByRole("button", { name: /Reset zoom/ }));
    expect(onZoomChange).toHaveBeenCalledWith(1);
  });

  it("disables zoom steps at the ends", () => {
    renderViewport({ zoom: 0.25, onZoomChange: () => {} });
    expect((screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    cleanup();
    renderViewport({ zoom: 2, onZoomChange: () => {} });
    expect((screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
