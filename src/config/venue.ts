/**
 * Single source of truth for the venue, fixture, pricing and bowl shape.
 * Everything here is fictional placeholder data; swap it when a real
 * organiser agreement exists.
 */

export type Lang = 'ar' | 'en';
export type Localized = Record<Lang, string>;

export interface TierConfig {
  id: number;
  rows: number;
  blocks: number;
  /** Horizontal distance from the bowl's inner edge to the first row (m). */
  innerOffset: number;
  /** Height of the first row (m). */
  baseY: number;
  rowDepth: number;
  rowRise: number;
  /** Block labels are labelBase + block number, e.g. 101..128. */
  labelBase: number;
}

export interface CategoryConfig {
  id: number;
  name: Localized;
  price: number;
  color: string;
}

export interface TeamConfig {
  name: Localized;
  short: string;
  colors: [string, string];
}

export const venue = {
  id: 'grand-oasis',
  name: { ar: 'ملعب الواحة الكبير', en: 'Grand Oasis Stadium' } as Localized,
  city: { ar: 'مدينة الواحة', en: 'Oasis City' } as Localized,
  fixture: {
    competition: { ar: 'دوري المحترفين · الجولة 12', en: 'Pro League · Matchday 12' } as Localized,
    kickoff: '2027-01-22T20:00:00+02:00',
    home: {
      name: { ar: 'الشروق', en: 'Al-Shorouk' },
      short: 'SHR',
      colors: ['#14b8a6', '#f8fafc'],
    } as TeamConfig,
    away: {
      name: { ar: 'المرفأ', en: 'Al-Marfa' },
      short: 'MRF',
      colors: ['#f97316', '#1e293b'],
    } as TeamConfig,
  },
  currency: 'EGP',
  /** Service fee as a fraction of the seat price; always shown with the price. */
  serviceFeeRate: 0.05,
  maxSeatsPerOrder: 6,
  /** Seed for the deterministic "already sold" demo data. */
  soldSeed: 20270122,
  bowl: {
    /** Semi-axes of the bowl's inner edge (m). x runs along the pitch length. */
    a: 74,
    b: 54,
    seatWidth: 0.52,
    aisle: 1.4,
  },
  tiers: [
    { id: 1, rows: 22, blocks: 28, innerOffset: 0, baseY: 1.2, rowDepth: 0.82, rowRise: 0.36, labelBase: 100 },
    { id: 2, rows: 14, blocks: 28, innerOffset: 21, baseY: 10.6, rowDepth: 0.82, rowRise: 0.5, labelBase: 200 },
    { id: 3, rows: 20, blocks: 32, innerOffset: 35, baseY: 19.6, rowDepth: 0.85, rowRise: 0.62, labelBase: 300 },
  ] as TierConfig[],
  categories: [
    { id: 1, name: { ar: 'الفئة الأولى', en: 'Category 1' }, price: 1200, color: '#f5c542' },
    { id: 2, name: { ar: 'الفئة الثانية', en: 'Category 2' }, price: 750, color: '#38bdf8' },
    { id: 3, name: { ar: 'الفئة الثالثة', en: 'Category 3' }, price: 450, color: '#a78bfa' },
    { id: 4, name: { ar: 'الفئة الرابعة', en: 'Category 4' }, price: 250, color: '#4ade80' },
  ] as CategoryConfig[],
};

export type Venue = typeof venue;

export function categoryById(id: number): CategoryConfig {
  const c = venue.categories.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown category ${id}`);
  return c;
}
