import { describe, expect, it } from 'vitest';
import { venue } from '../src/config/venue';
import { buildEllipseTable, pointAtArc } from '../src/domain/geometry';
import {
  buildLayout,
  computeSold,
  findSeatIndex,
  freeSeatInNextRow,
  nextFreeSeat,
  SEAT_FREE,
  SEAT_SOLD,
  seatId,
} from '../src/domain/layout';
import { basketTotals, canAddToBasket, seatFee, seatTotal } from '../src/domain/pricing';
import { viewScore } from '../src/domain/viewScore';

const layout = buildLayout(venue);

describe('ellipse arc table', () => {
  it('matches the circumference of a circle', () => {
    const table = buildEllipseTable(10, 10);
    expect(table.length).toBeCloseTo(2 * Math.PI * 10, 2);
  });

  it('places equal arc steps at equal distances', () => {
    const table = buildEllipseTable(74, 54);
    const a = pointAtArc(table, 100);
    const b = pointAtArc(table, 100.52);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0.52, 2);
  });

  it('wraps around the full length', () => {
    const table = buildEllipseTable(74, 54);
    const a = pointAtArc(table, 5);
    const b = pointAtArc(table, 5 + table.length);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
  });
});

describe('layout', () => {
  it('builds every configured block', () => {
    const expected = venue.tiers.reduce((n, t) => n + t.blocks, 0);
    expect(layout.blocks).toHaveLength(expected);
  });

  it('has a realistic capacity', () => {
    expect(layout.seatCount).toBeGreaterThan(35000);
    expect(layout.seatCount).toBeLessThan(70000);
  });

  it('accounts for every seat exactly once', () => {
    const total = layout.blocks.reduce((n, b) => n + b.seatCount, 0);
    expect(total).toBe(layout.seatCount);
    let cursor = 0;
    for (const block of layout.blocks) {
      expect(block.seatStart).toBe(cursor);
      cursor += block.seatCount;
    }
  });

  it('keeps every seat off the pitch and above ground', () => {
    for (let i = 0; i < layout.seatCount; i += 37) {
      const x = layout.pos[i * 3];
      const y = layout.pos[i * 3 + 1];
      const z = layout.pos[i * 3 + 2];
      expect(Math.abs(x) > 52.5 || Math.abs(z) > 34).toBe(true);
      expect(y).toBeGreaterThan(0);
    }
  });

  it('keeps neighbouring seats from overlapping', () => {
    const row = layout.blocks[0].rows[0];
    for (let j = 0; j < row.count - 1; j++) {
      const a = row.seatStart + j;
      const d = Math.hypot(
        layout.pos[a * 3] - layout.pos[(a + 1) * 3],
        layout.pos[a * 3 + 2] - layout.pos[(a + 1) * 3 + 2],
      );
      expect(d).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('round-trips seat ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < layout.seatCount; i += 101) {
      const id = seatId(layout, i);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      expect(findSeatIndex(layout, id)).toBe(i);
    }
  });

  it('rejects malformed or out-of-range ids', () => {
    expect(findSeatIndex(layout, 'nope')).toBe(-1);
    expect(findSeatIndex(layout, '999-1-1')).toBe(-1);
    expect(findSeatIndex(layout, '101-0-1')).toBe(-1);
    expect(findSeatIndex(layout, '101-1-9999')).toBe(-1);
    expect(findSeatIndex(layout, "101-1-1'; drop")).toBe(-1);
  });

  it('uses all four price categories', () => {
    expect(new Set(layout.blocks.map((b) => b.category))).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe('availability', () => {
  const status = computeSold(layout, venue.soldSeed);

  it('is deterministic for a seed', () => {
    expect(computeSold(layout, venue.soldSeed)).toEqual(status);
  });

  it('sells roughly half the stadium', () => {
    const sold = status.reduce((n, s) => n + (s === SEAT_SOLD ? 1 : 0), 0);
    const ratio = sold / layout.seatCount;
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
  });

  it('finds the next free seat inside the same block', () => {
    const block = layout.blocks[3];
    const next = nextFreeSeat(layout, status, block.seatStart);
    expect(next).toBeGreaterThan(block.seatStart);
    expect(next).toBeLessThan(block.seatStart + block.seatCount);
    expect(status[next]).toBe(SEAT_FREE);
  });

  it('moves to a free seat in a different row', () => {
    const block = layout.blocks[3];
    const start = block.rows[0].seatStart;
    const next = freeSeatInNextRow(layout, status, start);
    expect(status[next]).toBe(SEAT_FREE);
    expect(layout.seatRow[next]).not.toBe(layout.seatRow[start]);
    expect(layout.seatBlock[next]).toBe(block.index);
  });

  it('returns -1 when the block is full', () => {
    const full = new Uint8Array(layout.seatCount).fill(SEAT_SOLD);
    expect(nextFreeSeat(layout, full, 0)).toBe(-1);
    expect(freeSeatInNextRow(layout, full, 0)).toBe(-1);
  });
});

describe('view score', () => {
  it('stays within 0–100 for every sampled seat', () => {
    for (let i = 0; i < layout.seatCount; i += 53) {
      const s = viewScore(layout.pos[i * 3], layout.pos[i * 3 + 1], layout.pos[i * 3 + 2]);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('rates the halfway line above behind the goal at the same distance', () => {
    expect(viewScore(0, 6, 70)).toBeGreaterThan(viewScore(70, 6, 0));
  });

  it('rates closer seats above distant ones', () => {
    expect(viewScore(0, 6, 62)).toBeGreaterThan(viewScore(0, 30, 130));
  });
});

describe('pricing', () => {
  it('rounds the fee per seat', () => {
    expect(seatFee(750, 0.05)).toBe(38);
    expect(seatTotal(750, 0.05)).toBe(788);
  });

  it('adds up to the sum of the per-seat totals shown', () => {
    const prices = [1200, 750, 750, 250];
    const totals = basketTotals(prices.map((price) => ({ price })), 0.05);
    expect(totals.subtotal).toBe(2950);
    expect(totals.total).toBe(prices.reduce((n, p) => n + seatTotal(p, 0.05), 0));
    expect(totals.fees).toBe(totals.total - totals.subtotal);
  });

  it('handles an empty basket', () => {
    expect(basketTotals([], 0.05)).toEqual({ subtotal: 0, fees: 0, total: 0 });
  });

  it('enforces the per-order limit', () => {
    expect(canAddToBasket(5, 6)).toBe(true);
    expect(canAddToBasket(6, 6)).toBe(false);
  });
});
