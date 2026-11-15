import { hash01, hashString } from '../domain/rng';

/**
 * Decorative ticket code. Deliberately not a scannable QR code: demo tickets
 * must never be mistaken for valid ones.
 */
export function ticketPattern(text: string, label: string): string {
  const size = 21;
  const seed = hashString(text);
  const cells: string[] = [];
  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inFinder(x, y)) continue;
      if (hash01(seed, y * size + x) < 0.48) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }
  const finder = (x: number, y: number) =>
    `<rect x="${x}" y="${y}" width="7" height="7"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return (
    `<svg class="ticket-code" viewBox="-1 -1 ${size + 2} ${size + 2}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    `<rect x="-1" y="-1" width="${size + 2}" height="${size + 2}" fill="#fff"/>` +
    `<g fill="#0b0f17">${cells.join('')}${finder(0, 0)}${finder(size - 7, 0)}${finder(0, size - 7)}</g></svg>`
  );
}
