import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from './backend';
import { createLocalBackend } from './localBackend';
import { BackendError } from './errors';
import { cacheStorageKey } from './localCache';
import { SyncEngine } from './syncEngine';
import type { Session } from '../types';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

const BABY = 'leo-2026';
let backend: Backend;
let session: Session;
let storage: MemoryStorage;

/** Simulates opening the app on a brand-new device: same server, empty local cache. */
function freshDevice(s: Session, onSessionExpired = () => {}): SyncEngine {
  storage.removeItem(cacheStorageKey(s.babyId));
  return new SyncEngine({ backend, session: s, onSessionExpired });
}

beforeEach(async () => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' });
  backend = createLocalBackend();
  session = await backend.createBaby({
    babyId: BABY,
    babyName: 'Leo',
    password: 'secret123',
    deviceLabel: 'Phone',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth (local backend)', () => {
  it('logs in with the right password and rejects the wrong one', async () => {
    const ok = await backend.login({ babyId: BABY, password: 'secret123', deviceLabel: 'Laptop' });
    expect(ok.babyName).toBe('Leo');
    expect(ok.token).not.toBe(session.token);

    await expect(backend.login({ babyId: BABY, password: 'nope-nope', deviceLabel: 'Laptop' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('rejects duplicate Baby IDs', async () => {
    await expect(
      backend.createBaby({ babyId: BABY, babyName: 'Other', password: 'secret123', deviceLabel: 'Phone' }),
    ).rejects.toMatchObject({ code: 'baby_id_taken' });
  });

  it('rejects an invalid Baby ID and a short password', async () => {
    await expect(
      backend.createBaby({ babyId: 'A B', babyName: 'x', password: 'secret123', deviceLabel: 'Phone' }),
    ).rejects.toMatchObject({ code: 'invalid_baby_id' });
    await expect(
      backend.createBaby({ babyId: 'new-baby', babyName: 'x', password: '123', deviceLabel: 'Phone' }),
    ).rejects.toMatchObject({ code: 'weak_password' });
  });
});

describe('SyncEngine', () => {
  it('writes locally first, then pushes to the server', async () => {
    const engine = new SyncEngine({ backend, session, onSessionExpired: () => {} });
    const event = engine.logEvent('milk', Date.now());

    // Local UI state is updated before any network call finishes.
    expect(engine.getSnapshot().events.map((e) => e.id)).toEqual([event.id]);

    await engine.sync();
    const snap = engine.getSnapshot();
    expect(snap.pendingCount).toBe(0);
    expect(snap.status).toBe('synced');

    // A brand-new device pulls the same event from the server.
    const other = freshDevice(session);
    await other.sync();
    expect(other.getSnapshot().events.map((e) => [e.id, e.type, e.deviceLabel])).toEqual([[event.id, 'milk', 'Phone']]);
  });

  it('queues writes while offline and flushes them when back online', async () => {
    const engine = new SyncEngine({ backend, session, onSessionExpired: () => {} });
    const realUpsert = backend.upsertEvents.bind(backend);
    backend.upsertEvents = vi.fn(async () => {
      throw new BackendError('network', 'Failed to fetch');
    });

    engine.logEvent('urine', Date.now());
    await engine.sync();
    expect(engine.getSnapshot().status).toBe('offline');
    expect(engine.getSnapshot().pendingCount).toBe(1);

    backend.upsertEvents = realUpsert;
    await engine.sync();
    expect(engine.getSnapshot().pendingCount).toBe(0);
    expect(engine.getSnapshot().status).toBe('synced');
  });

  it('propagates undo as a tombstone to other devices', async () => {
    const engine = new SyncEngine({ backend, session, onSessionExpired: () => {} });
    const event = engine.logEvent('potty', Date.now());
    await engine.sync();

    engine.deleteEvent(event.id);
    expect(engine.getSnapshot().events).toHaveLength(0);
    await engine.sync();

    const other = freshDevice(session);
    await other.sync();
    expect(other.getSnapshot().events).toHaveLength(0);
  });

  it('keeps an unsent local edit over an older server copy', async () => {
    const engine = new SyncEngine({ backend, session, onSessionExpired: () => {} });
    const event = engine.logEvent('milk', Date.now());
    await engine.sync();

    // Edit locally while the upload is blocked.
    backend.upsertEvents = vi.fn(async () => {
      throw new BackendError('network', 'Failed to fetch');
    });
    engine.updateDetails(event.id, { amountMl: 120, label: '120 ml' });
    await engine.sync();

    expect(engine.getSnapshot().events[0].details).toEqual({ amountMl: 120, label: '120 ml' });
    expect(engine.getSnapshot().pendingCount).toBe(1);
  });

  it('signals session expiry instead of silently failing', async () => {
    const onSessionExpired = vi.fn();
    const engine = new SyncEngine({ backend, session: { ...session, token: 'bogus' }, onSessionExpired });
    await engine.sync();
    expect(onSessionExpired).toHaveBeenCalled();
    expect(engine.getSnapshot().status).toBe('error');
  });
});
