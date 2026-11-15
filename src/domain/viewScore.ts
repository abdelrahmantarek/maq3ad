import { sideCentrality } from './layout';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * 0–100 rating of how good the view of the pitch is from a seat.
 * Closer, moderately elevated seats near the halfway line score highest.
 */
export function viewScore(x: number, y: number, z: number): number {
  const horizontal = Math.hypot(x, z);
  const distance = clamp01(1 - (horizontal - 55) / 85);
  const elevation = (Math.atan2(y, horizontal) * 180) / Math.PI;
  const angle = clamp01(1 - Math.abs(elevation - 14) / 16);
  const centrality = sideCentrality(x, z);
  const score = 100 * (0.4 * distance + 0.2 * angle + 0.4 * (0.35 + 0.65 * centrality));
  return Math.round(Math.min(100, Math.max(0, score)));
}
