export type Detent = 'peek' | 'half' | 'full';
export const DETENTS: Detent[] = ['peek', 'half', 'full'];
/** Flick speed (px/ms) that moves one detent regardless of where the sheet was let go. */
const FLICK = 0.45;

/** Height after a drag: a flick moves one step that way, otherwise the nearest detent wins. */
export function snapDetent(
  heights: Record<Detent, number>,
  height: number,
  velocity: number
): Detent {
  if (velocity < -FLICK) return DETENTS.find((d) => heights[d] > height + 1) ?? 'full';
  if (velocity > FLICK)
    return [...DETENTS].reverse().find((d) => heights[d] < height - 1) ?? 'peek';
  return DETENTS.reduce((best, d) =>
    Math.abs(heights[d] - height) < Math.abs(heights[best] - height) ? d : best
  );
}
