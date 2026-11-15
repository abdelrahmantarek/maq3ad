export interface Booking {
  reference: string;
  seatIds: string[];
  createdAt: string;
}

/**
 * Storage boundary for bookings. The UI only talks to this interface, so a
 * real backend can replace the local implementation without UI changes.
 */
export interface BookingRepository {
  list(): Promise<Booking[]>;
  /** Rejects if any seat is already booked. */
  book(seatIds: string[]): Promise<Booking>;
  reset(): Promise<void>;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SeatUnavailableError extends Error {
  constructor(public readonly seatIds: string[]) {
    super(`Seats already booked: ${seatIds.join(', ')}`);
    this.name = 'SeatUnavailableError';
  }
}

function isBooking(v: unknown): v is Booking {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.reference === 'string' &&
    typeof b.createdAt === 'string' &&
    Array.isArray(b.seatIds) &&
    b.seatIds.every((s) => typeof s === 'string')
  );
}

export function makeReference(random: () => number = secureRandom): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return `MQ-${out.slice(0, 4)}-${out.slice(4)}`;
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

/** Demo persistence in the visitor's own browser. Not shared between devices. */
export class LocalBookingRepository implements BookingRepository {
  constructor(
    private readonly store: KeyValueStore | null,
    private readonly key = 'maq3ad.bookings.v1',
  ) {}

  private memory: Booking[] = [];

  private read(): Booking[] {
    if (!this.store) return this.memory;
    try {
      const raw = this.store.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isBooking) : [];
    } catch {
      return this.memory;
    }
  }

  private write(bookings: Booking[]): void {
    this.memory = bookings;
    if (!this.store) return;
    try {
      this.store.setItem(this.key, JSON.stringify(bookings));
    } catch {
      // Storage full or blocked: keep the in-memory copy for this session.
    }
  }

  async list(): Promise<Booking[]> {
    return this.read();
  }

  async book(seatIds: string[]): Promise<Booking> {
    if (seatIds.length === 0) throw new Error('No seats selected');
    const existing = this.read();
    const taken = new Set(existing.flatMap((b) => b.seatIds));
    const clash = seatIds.filter((id) => taken.has(id));
    if (clash.length > 0) throw new SeatUnavailableError(clash);
    const booking: Booking = {
      reference: makeReference(),
      seatIds: [...seatIds],
      createdAt: new Date().toISOString(),
    };
    this.write([...existing, booking]);
    return booking;
  }

  async reset(): Promise<void> {
    this.memory = [];
    if (!this.store) return;
    try {
      this.store.removeItem(this.key);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }
}

export function browserStore(): KeyValueStore | null {
  try {
    const probe = '__maq3ad_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
