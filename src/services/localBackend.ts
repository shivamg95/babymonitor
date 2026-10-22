import type { Backend, CreateBabyInput, LoginInput } from './backend';
import { BABY_ID_PATTERN, BackendError, MIN_PASSWORD_LENGTH } from './errors';
import type { BabyEvent, Session } from '../types';
import { hashPassword, randomHex, verifyPassword } from '../utils/crypto';
import { parseTimestamp } from '../utils/time';

/*
 * Local demo backend. It stands in for the server when Supabase is not configured.
 * "Server" data lives in localStorage, and tabs in the same browser sync through
 * BroadcastChannel. This lets you test the full login, multi-device and sync flow
 * with no backend. It is not secure and not cross-device.
 */

interface StoredBaby {
  babyName: string;
  salt: string;
  hash: string;
}

type BabyStore = Record<string, StoredBaby>;
type SessionStore = Record<string, { babyId: string }>;
type EventStore = Record<string, BabyEvent>;

const BABIES_KEY = 'bm:local:babies';
const SESSIONS_KEY = 'bm:local:sessions';
const eventsKey = (babyId: string) => `bm:local:events:${babyId}`;
const channelName = (babyId: string) => `bm-local-${babyId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function assertSession(session: Session): void {
  const sessions = read<SessionStore>(SESSIONS_KEY, {});
  if (sessions[session.token]?.babyId !== session.babyId) {
    throw new BackendError('invalid_session', 'invalid_session');
  }
}

function issueSession(babyId: string, babyName: string, deviceLabel: string): Session {
  const token = randomHex(32);
  const sessions = read<SessionStore>(SESSIONS_KEY, {});
  sessions[token] = { babyId };
  write(SESSIONS_KEY, sessions);
  return { mode: 'local', babyId, babyName, token, deviceLabel };
}

export function createLocalBackend(): Backend {
  const senders = new Map<string, BroadcastChannel>();

  function sender(babyId: string): BroadcastChannel | null {
    if (typeof BroadcastChannel === 'undefined') return null;
    let ch = senders.get(babyId);
    if (!ch) {
      ch = new BroadcastChannel(channelName(babyId));
      senders.set(babyId, ch);
    }
    return ch;
  }

  return {
    mode: 'local',

    async createBaby(input: CreateBabyInput): Promise<Session> {
      const babyId = input.babyId.trim().toLowerCase();
      const babyName = input.babyName.trim();
      if (!BABY_ID_PATTERN.test(babyId)) throw new BackendError('invalid_baby_id', 'invalid_baby_id');
      if (!babyName) throw new BackendError('invalid_baby_name', 'invalid_baby_name');
      if (input.password.length < MIN_PASSWORD_LENGTH) throw new BackendError('weak_password', 'weak_password');

      const babies = read<BabyStore>(BABIES_KEY, {});
      if (babies[babyId]) throw new BackendError('baby_id_taken', 'baby_id_taken');

      const { salt, hash } = await hashPassword(input.password);
      babies[babyId] = { babyName, salt, hash };
      write(BABIES_KEY, babies);
      return issueSession(babyId, babyName, input.deviceLabel);
    },

    async login(input: LoginInput): Promise<Session> {
      const babyId = input.babyId.trim().toLowerCase();
      const babies = read<BabyStore>(BABIES_KEY, {});
      const baby = babies[babyId];
      if (!baby || !(await verifyPassword(input.password, baby.salt, baby.hash))) {
        throw new BackendError('invalid_credentials', 'invalid_credentials');
      }
      return issueSession(babyId, baby.babyName, input.deviceLabel);
    },

    async logout(session: Session): Promise<void> {
      const sessions = read<SessionStore>(SESSIONS_KEY, {});
      delete sessions[session.token];
      write(SESSIONS_KEY, sessions);
    },

    async listEvents(session, since, limit) {
      assertSession(session);
      const sinceMs = since ? parseTimestamp(since) : null;
      return Object.values(read<EventStore>(eventsKey(session.babyId), {}))
        .filter((e) => e.updatedAt !== null && (sinceMs === null || parseTimestamp(e.updatedAt) > sinceMs))
        .sort((a, b) => parseTimestamp(a.updatedAt as string) - parseTimestamp(b.updatedAt as string))
        .slice(0, limit);
    },

    async upsertEvents(session, events) {
      assertSession(session);
      if (events.length === 0) return;
      const key = eventsKey(session.babyId);
      const store = read<EventStore>(key, {});
      const serverNow = new Date().toISOString();
      for (const e of events) {
        store[e.id] = { ...e, babyId: session.babyId, updatedAt: serverNow };
      }
      write(key, store);
    },

    subscribe(babyId, onChange) {
      if (typeof BroadcastChannel === 'undefined') return () => {};
      const ch = new BroadcastChannel(channelName(babyId));
      ch.onmessage = () => onChange();
      return () => ch.close();
    },

    notify(babyId) {
      sender(babyId)?.postMessage('changed');
    },
  };
}
