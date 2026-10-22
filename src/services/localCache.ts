import type { BabyEvent } from '../types';

/**
 * Per-device cache, kept in localStorage so it survives closing the PWA.
 * It holds every event this device has seen, the offline write queue, and the sync cursor.
 *
 * Storage is the source of truth. Every mutation is a synchronous read-modify-write
 * through updateCache(), so two tabs on the same device can't overwrite each other's queue.
 */
export interface QueuedWrite {
  /** Changes on each local edit, so a flush only clears the exact version it sent. */
  rev: string;
  event: BabyEvent;
}

export interface DeviceCache {
  events: Record<string, BabyEvent>;
  queue: Record<string, QueuedWrite>;
  /** updatedAt of the newest server change applied so far (ISO). */
  cursor: string | null;
}

export const cacheStorageKey = (babyId: string) => `bm:cache:${babyId}`;

function emptyCache(): DeviceCache {
  return { events: {}, queue: {}, cursor: null };
}

export function readCache(babyId: string): DeviceCache {
  try {
    const raw = localStorage.getItem(cacheStorageKey(babyId));
    if (!raw) return emptyCache();
    const parsed = JSON.parse(raw) as Partial<DeviceCache>;
    return {
      events: parsed.events ?? {},
      queue: parsed.queue ?? {},
      cursor: parsed.cursor ?? null,
    };
  } catch {
    return emptyCache();
  }
}

export function updateCache<T>(babyId: string, mutate: (cache: DeviceCache) => T): T {
  const cache = readCache(babyId);
  const result = mutate(cache);
  try {
    localStorage.setItem(cacheStorageKey(babyId), JSON.stringify(cache));
  } catch (err) {
    console.error('Could not save local cache (storage full?)', err);
  }
  return result;
}
