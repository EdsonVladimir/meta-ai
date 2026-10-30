// Board zoom steps: fixed levels keep boxes, edges and labels aligned
// (all geometry derives from layout constants, so CSS `zoom` scales
// every layer together). Pure and tested.
export const BOARD_ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const;

export function stepBoardZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return BOARD_ZOOM_STEPS.find((step) => step > current) ?? BOARD_ZOOM_STEPS[BOARD_ZOOM_STEPS.length - 1];
  }
  const below = [...BOARD_ZOOM_STEPS].reverse().find((step) => step < current);
  return below ?? BOARD_ZOOM_STEPS[0];
}

export function boardZoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}
