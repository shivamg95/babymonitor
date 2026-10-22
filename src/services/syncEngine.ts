import type { Backend } from './backend';
import { BackendError } from './errors';
import { cacheStorageKey, readCache, updateCache, type DeviceCache } from './localCache';
import type { BabyEvent, EventDetails, EventType, Session } from '../types';
import { uuid } from '../utils/crypto';
import { parseTimestamp } from '../utils/time';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncSnapshot {
  status: SyncStatus;
  /** Local changes not yet accepted by the server. */
  pendingCount: number;
  /** Live events (tombstones removed), newest first. */
  events: BabyEvent[];
  lastSyncedAt: number | null;
  errorMessage: string | null;
}

interface SyncEngineOptions {
  backend: Backend;
  session: Session;
  onSessionExpired: () => void;
}

const PAGE_SIZE = 500;
const MAX_PAGES = 200;
/** Re-read a little before the cursor, so events committed slightly out of order aren't missed. */
const CURSOR_OVERLAP_MS = 60_000;
/** Safety-net poll while the app is visible, in case a realtime nudge is lost. */
const PERIODIC_SYNC_MS = 60_000;

/**
 * Offline-first sync for one baby on one device.
 *
 * Writes go to the local cache first, so the UI updates instantly and works offline.
 * They are then pushed (flush) and other devices' changes are pulled (pull). Sync runs on
 * app open, focus, visibility change, network restore, realtime nudges and a 60s timer.
 */
export class SyncEngine {
  private readonly listeners = new Set<() => void>();
  private snapshot: SyncSnapshot;
  private chain: Promise<void> = Promise.resolve();
  private syncing = false;
  private failure: { status: 'offline' | 'error'; message: string } | null = null;
  private lastSyncedAt: number | null = null;
  private cleanups: Array<() => void> = [];

  constructor(private readonly options: SyncEngineOptions) {
    this.snapshot = this.buildSnapshot();
  }

  private get babyId(): string {
    return this.options.session.babyId;
  }

  // Arrow functions so they can be passed straight to useSyncExternalStore.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SyncSnapshot => this.snapshot;

  start(): void {
    const kick = () => void this.sync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    const onLocalCacheChanged = (e: StorageEvent) => {
      // Another tab on this device changed the cache. Re-render from storage.
      if (e.key === cacheStorageKey(this.babyId)) this.emit();
    };
    const onNetworkChange = () => this.emit();

    window.addEventListener('focus', kick);
    window.addEventListener('online', kick);
    window.addEventListener('offline', onNetworkChange);
    window.addEventListener('storage', onLocalCacheChanged);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') kick();
    }, PERIODIC_SYNC_MS);
    const unsubscribeRealtime = this.options.backend.subscribe(this.babyId, kick);

    this.cleanups = [
      () => window.removeEventListener('focus', kick),
      () => window.removeEventListener('online', kick),
      () => window.removeEventListener('offline', onNetworkChange),
      () => window.removeEventListener('storage', onLocalCacheChanged),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => window.clearInterval(interval),
      unsubscribeRealtime,
    ];

    kick();
  }

  stop(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  // ---------- Local writes (instant, then queued for upload) ----------

  logEvent(type: EventType, occurredAt: number): BabyEvent {
    const event: BabyEvent = {
      id: uuid(),
      babyId: this.babyId,
      type,
      occurredAt: new Date(occurredAt).toISOString(),
      details: {},
      deviceLabel: this.options.session.deviceLabel,
      deleted: false,
      updatedAt: null,
    };
    updateCache(this.babyId, (cache) => this.queueWrite(cache, event));
    this.afterLocalWrite();
    return event;
  }

  updateDetails(eventId: string, patch: EventDetails): void {
    const changed = updateCache(this.babyId, (cache) => {
      const current = cache.events[eventId];
      if (!current || current.deleted) return false;
      this.queueWrite(cache, { ...current, details: { ...current.details, ...patch } });
      return true;
    });
    if (changed) this.afterLocalWrite();
  }

  /** Soft delete (tombstone), so other devices remove the event too. */
  deleteEvent(eventId: string): void {
    const changed = updateCache(this.babyId, (cache) => {
      const current = cache.events[eventId];
      if (!current || current.deleted) return false;
      this.queueWrite(cache, { ...current, deleted: true });
      return true;
    });
    if (changed) this.afterLocalWrite();
  }

  // ---------- Sync ----------

  /** Push pending writes, then pull remote changes. Calls are serialized. */
  sync(): Promise<void> {
    this.chain = this.chain.then(() => this.runSync());
    return this.chain;
  }

  private async runSync(): Promise<void> {
    this.syncing = true;
    this.emit();
    try {
      await this.flush();
      await this.pull();
      this.lastSyncedAt = Date.now();
      this.failure = null;
    } catch (err) {
      this.failure = this.classify(err);
      if (err instanceof BackendError && err.code === 'invalid_session') {
        this.options.onSessionExpired();
      }
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  private async flush(): Promise<void> {
    const pending = Object.values(readCache(this.babyId).queue);
    if (pending.length === 0) return;

    await this.options.backend.upsertEvents(
      this.options.session,
      pending.map((p) => p.event),
    );

    // Clear only the exact versions we sent. An edit made during the request keeps its new rev.
    updateCache(this.babyId, (cache) => {
      for (const p of pending) {
        if (cache.queue[p.event.id]?.rev === p.rev) delete cache.queue[p.event.id];
      }
    });

    this.options.backend.notify(this.babyId);
  }

  private async pull(): Promise<void> {
    const cursor = readCache(this.babyId).cursor;
    let sinceMs: number | null = cursor ? parseTimestamp(cursor) - CURSOR_OVERLAP_MS : null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const since = sinceMs === null ? null : new Date(sinceMs).toISOString();
      const rows = await this.options.backend.listEvents(this.options.session, since, PAGE_SIZE);
      this.applyRemoteRows(rows);
      if (rows.length < PAGE_SIZE) return;

      // Full page means there may be more. Continue from the newest row we just got.
      const newest = Math.max(...rows.map((r) => (r.updatedAt ? parseTimestamp(r.updatedAt) : 0)));
      sinceMs = newest - 1;
    }
  }

  private applyRemoteRows(rows: BabyEvent[]): void {
    if (rows.length === 0) return;
    updateCache(this.babyId, (cache) => {
      for (const row of rows) {
        // An unsent local change for this event wins. It will be pushed and pulled back later.
        if (cache.queue[row.id]) continue;
        cache.events[row.id] = row;
        if (row.updatedAt && (!cache.cursor || parseTimestamp(row.updatedAt) > parseTimestamp(cache.cursor))) {
          cache.cursor = row.updatedAt;
        }
      }
    });
  }

  // ---------- Internals ----------

  private queueWrite(cache: DeviceCache, event: BabyEvent): void {
    cache.events[event.id] = event;
    cache.queue[event.id] = { rev: uuid(), event };
  }

  private afterLocalWrite(): void {
    this.emit();
    void this.sync();
  }

  private classify(err: unknown): { status: 'offline' | 'error'; message: string } {
    if (err instanceof BackendError) {
      if (err.code === 'network') {
        return { status: 'offline', message: 'Could not reach the server. Changes are saved on this device.' };
      }
      if (err.code === 'invalid_session') {
        return { status: 'error', message: 'Your session has expired. Please log in again.' };
      }
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  private computeStatus(pendingCount: number): SyncStatus {
    if (this.syncing) return 'syncing';
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
    if (this.failure) return this.failure.status;
    return pendingCount > 0 ? 'syncing' : 'synced';
  }

  private buildSnapshot(): SyncSnapshot {
    const cache = readCache(this.babyId);
    const pendingCount = Object.keys(cache.queue).length;
    const events = Object.values(cache.events)
      .filter((e) => !e.deleted)
      .sort((a, b) => parseTimestamp(b.occurredAt) - parseTimestamp(a.occurredAt));
    return {
      status: this.computeStatus(pendingCount),
      pendingCount,
      events,
      lastSyncedAt: this.lastSyncedAt,
      errorMessage: this.failure?.message ?? null,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
