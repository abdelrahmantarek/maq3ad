import { describe, expect, it } from 'vitest';
import {
  LocalBookingRepository,
  makeReference,
  SeatUnavailableError,
  type KeyValueStore,
} from '../src/data/bookingRepository';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('LocalBookingRepository', () => {
  it('stores and lists a booking', async () => {
    const repo = new LocalBookingRepository(memoryStore());
    const booking = await repo.book(['101-1-1', '101-1-2']);
    expect(booking.reference).toMatch(/^MQ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await repo.list()).toEqual([booking]);
  });

  it('persists across instances sharing a store', async () => {
    const store = memoryStore();
    await new LocalBookingRepository(store).book(['205-3-4']);
    const again = await new LocalBookingRepository(store).list();
    expect(again[0].seatIds).toEqual(['205-3-4']);
  });

  it('refuses to book a seat twice', async () => {
    const repo = new LocalBookingRepository(memoryStore());
    await repo.book(['101-1-1']);
    await expect(repo.book(['101-1-2', '101-1-1'])).rejects.toBeInstanceOf(SeatUnavailableError);
    expect(await repo.list()).toHaveLength(1);
  });

  it('refuses an empty booking', async () => {
    const repo = new LocalBookingRepository(memoryStore());
    await expect(repo.book([])).rejects.toThrow();
  });

  it('clears everything on reset', async () => {
    const store = memoryStore();
    const repo = new LocalBookingRepository(store);
    await repo.book(['101-1-1']);
    await repo.reset();
    expect(await repo.list()).toEqual([]);
    expect(Object.keys(store.data)).toHaveLength(0);
  });

  it('ignores corrupted or tampered storage', async () => {
    const key = 'maq3ad.bookings.v1';
    expect(await new LocalBookingRepository(memoryStore({ [key]: '{not json' })).list()).toEqual([]);
    expect(await new LocalBookingRepository(memoryStore({ [key]: '{"a":1}' })).list()).toEqual([]);
    const mixed = JSON.stringify([{ reference: 'x', seatIds: [1], createdAt: 'y' }, { nope: true }]);
    expect(await new LocalBookingRepository(memoryStore({ [key]: mixed })).list()).toEqual([]);
  });

  it('still works when storage is unavailable', async () => {
    const repo = new LocalBookingRepository(null);
    await repo.book(['101-1-1']);
    expect(await repo.list()).toHaveLength(1);
  });

  it('survives a store that throws on write', async () => {
    const store = memoryStore();
    store.setItem = () => {
      throw new Error('quota');
    };
    const repo = new LocalBookingRepository(store);
    await expect(repo.book(['101-1-1'])).resolves.toBeDefined();
  });
});

describe('makeReference', () => {
  it('uses the supplied random source', () => {
    expect(makeReference(() => 0)).toBe('MQ-AAAA-AAAA');
  });
});
