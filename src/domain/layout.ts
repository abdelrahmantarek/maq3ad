import type { Venue } from '../config/venue';
import { buildEllipseTable, pointAtArc, type EllipseTable } from './geometry';
import { hash01 } from './rng';

export const SEAT_FREE = 0;
export const SEAT_SOLD = 1;
export const SEAT_MINE = 2;

export interface RowInfo {
  row: number;
  seatStart: number;
  count: number;
}

export interface Block {
  index: number;
  tier: number;
  label: string;
  category: number;
  /** Ellipse parameter angles bounding the block (at its first row). */
  t0: number;
  t1: number;
  centerT: number;
  center: [number, number, number];
  /** Outward horizontal unit normal at the block centre. */
  normal: [number, number];
  innerOffset: number;
  outerOffset: number;
  yMin: number;
  yMax: number;
  seatStart: number;
  seatCount: number;
  rows: RowInfo[];
  /** Visiting-supporters section (only affects crowd colours). */
  away: boolean;
}

export interface Layout {
  blocks: Block[];
  seatCount: number;
  /** xyz per seat. */
  pos: Float32Array;
  /** Y rotation so the seat faces the pitch. */
  rotY: Float32Array;
  seatBlock: Uint16Array;
  seatRow: Uint8Array;
  seatNum: Uint8Array;
}

/** 1 on the long sides (best sightlines), 0 behind the goals. */
export function sideCentrality(x: number, z: number): number {
  const d = Math.hypot(x, z);
  return d === 0 ? 1 : Math.abs(z) / d;
}

function categoryFor(tier: number, centrality: number): number {
  if (tier === 1) return centrality > 0.8 ? 1 : centrality > 0.4 ? 2 : 3;
  if (tier === 2) return centrality > 0.75 ? 2 : 3;
  return centrality > 0.6 ? 3 : 4;
}

export function buildLayout(v: Venue): Layout {
  const { a, b, seatWidth, aisle } = v.bowl;
  const blocks: Block[] = [];
  const pos: number[] = [];
  const rotY: number[] = [];
  const seatBlock: number[] = [];
  const seatRow: number[] = [];
  const seatNum: number[] = [];

  for (const tier of v.tiers) {
    const tables: EllipseTable[] = [];
    for (let r = 0; r < tier.rows; r++) {
      const off = tier.innerOffset + (r + 0.5) * tier.rowDepth;
      tables.push(buildEllipseTable(a + off, b + off));
    }
    const first = tables[0];
    const mid = tables[tier.rows >> 1];

    for (let i = 0; i < tier.blocks; i++) {
      const index = blocks.length;
      const seatStart = seatBlock.length;
      const rows: RowInfo[] = [];

      for (let r = 0; r < tier.rows; r++) {
        const table = tables[r];
        const span = table.length / tier.blocks;
        const usable = span - aisle;
        const count = Math.min(255, Math.max(1, Math.floor(usable / seatWidth)));
        const pitch = usable / count;
        const s0 = i * span + aisle / 2;
        const y = tier.baseY + r * tier.rowRise;
        rows.push({ row: r + 1, seatStart: seatBlock.length, count });
        for (let j = 0; j < count; j++) {
          const p = pointAtArc(table, s0 + (j + 0.5) * pitch);
          pos.push(p.x, y, p.z);
          rotY.push(Math.atan2(-p.nx, -p.nz));
          seatBlock.push(index);
          seatRow.push(r + 1);
          seatNum.push(j + 1);
        }
      }

      const firstSpan = first.length / tier.blocks;
      const midSpan = mid.length / tier.blocks;
      const p0 = pointAtArc(first, i * firstSpan);
      const p1 = pointAtArc(first, (i + 1) * firstSpan - 1e-6);
      const pc = pointAtArc(mid, (i + 0.5) * midSpan);
      const yMin = tier.baseY;
      const yMax = tier.baseY + (tier.rows - 1) * tier.rowRise;
      const centrality = sideCentrality(pc.x, pc.z);

      blocks.push({
        index,
        tier: tier.id,
        label: String(tier.labelBase + i + 1),
        category: categoryFor(tier.id, centrality),
        t0: p0.t,
        t1: p1.t < p0.t ? p1.t + Math.PI * 2 : p1.t,
        centerT: pc.t,
        center: [pc.x, (yMin + yMax) / 2, pc.z],
        normal: [pc.nx, pc.nz],
        innerOffset: tier.innerOffset,
        outerOffset: tier.innerOffset + tier.rows * tier.rowDepth,
        yMin,
        yMax,
        seatStart,
        seatCount: seatBlock.length - seatStart,
        rows,
        away: tier.id === 3 && Math.cos(pc.t) > 0.86,
      });
    }
  }

  return {
    blocks,
    seatCount: seatBlock.length,
    pos: new Float32Array(pos),
    rotY: new Float32Array(rotY),
    seatBlock: new Uint16Array(seatBlock),
    seatRow: new Uint8Array(seatRow),
    seatNum: new Uint8Array(seatNum),
  };
}

/** Deterministic demo availability: roughly half the seats are already sold. */
export function computeSold(layout: Layout, seed: number): Uint8Array {
  const status = new Uint8Array(layout.seatCount);
  for (const block of layout.blocks) {
    const ratio = 0.25 + 0.5 * hash01(seed, 100000 + block.index);
    const end = block.seatStart + block.seatCount;
    for (let i = block.seatStart; i < end; i++) {
      status[i] = hash01(seed, i) < ratio ? SEAT_SOLD : SEAT_FREE;
    }
  }
  return status;
}

export function seatId(layout: Layout, i: number): string {
  return `${layout.blocks[layout.seatBlock[i]].label}-${layout.seatRow[i]}-${layout.seatNum[i]}`;
}

export function findSeatIndex(layout: Layout, id: string): number {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(id);
  if (!m) return -1;
  const block = layout.blocks.find((bl) => bl.label === m[1]);
  if (!block) return -1;
  const row = block.rows[Number(m[2]) - 1];
  const num = Number(m[3]);
  if (!row || num < 1 || num > row.count) return -1;
  return row.seatStart + num - 1;
}

export function rowOf(layout: Layout, i: number): RowInfo {
  return layout.blocks[layout.seatBlock[i]].rows[layout.seatRow[i] - 1];
}

/** Next free seat after i within its block, wrapping around; -1 if none. */
export function nextFreeSeat(layout: Layout, status: Uint8Array, i: number): number {
  const block = layout.blocks[layout.seatBlock[i]];
  for (let k = 1; k < block.seatCount; k++) {
    const j = block.seatStart + ((i - block.seatStart + k) % block.seatCount);
    if (status[j] === SEAT_FREE) return j;
  }
  return -1;
}

/** Closest free seat in the next row up (wraps to row 1); -1 if none. */
export function freeSeatInNextRow(layout: Layout, status: Uint8Array, i: number): number {
  const block = layout.blocks[layout.seatBlock[i]];
  const current = rowOf(layout, i);
  const frac = (layout.seatNum[i] - 0.5) / current.count;
  for (let step = 1; step < block.rows.length; step++) {
    const row = block.rows[(current.row - 1 + step) % block.rows.length];
    const want = Math.min(row.count - 1, Math.floor(frac * row.count));
    for (let d = 0; d < row.count; d++) {
      for (const j of [want + d, want - d]) {
        if (j >= 0 && j < row.count && status[row.seatStart + j] === SEAT_FREE) return row.seatStart + j;
      }
    }
  }
  return -1;
}
