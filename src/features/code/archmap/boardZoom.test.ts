// Board zoom steps: fixed levels, clamped at both ends.
import { describe, expect, it } from "vitest";
import { BOARD_ZOOM_STEPS, boardZoomPercent, stepBoardZoom } from "./boardZoom";

describe("stepBoardZoom", () => {
  it("moves one level per step from exact levels", () => {
    expect(stepBoardZoom(1, 1)).toBe(1.25);
    expect(stepBoardZoom(1, -1)).toBe(0.8);
    expect(stepBoardZoom(1.5, 1)).toBe(2);
  });

  it("clamps at the extremes", () => {
    expect(stepBoardZoom(BOARD_ZOOM_STEPS[0], -1)).toBe(BOARD_ZOOM_STEPS[0]);
    expect(
      stepBoardZoom(BOARD_ZOOM_STEPS[BOARD_ZOOM_STEPS.length - 1], 1),
    ).toBe(BOARD_ZOOM_STEPS[BOARD_ZOOM_STEPS.length - 1]);
  });

  it("moves to the next strictly greater or smaller level", () => {
    expect(stepBoardZoom(0.9, 1)).toBe(1);
    expect(stepBoardZoom(0.9, -1)).toBe(0.8);
    expect(stepBoardZoom(1.1, 1)).toBe(1.25);
    expect(stepBoardZoom(1.1, -1)).toBe(1);
  });

  it("formats percents", () => {
    expect(boardZoomPercent(1)).toBe(100);
    expect(boardZoomPercent(0.67)).toBe(67);
  });
});
