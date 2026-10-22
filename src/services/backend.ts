import type { BabyEvent, BackendMode, Session } from '../types';
import { createSupabaseBackend } from './supabaseBackend';
import { createLocalBackend } from './localBackend';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export interface CreateBabyInput {
  babyId: string;
  babyName: string;
  password: string;
  deviceLabel: string;
}

export interface LoginInput {
  babyId: string;
  password: string;
  deviceLabel: string;
}

/**
 * The remote side of the app. Two implementations exist: Supabase (real multi-device sync)
 * and a local demo backend (localStorage + BroadcastChannel, same-browser tabs) that is used
 * when Supabase keys are not configured.
 */
export interface Backend {
  readonly mode: BackendMode;
  createBaby(input: CreateBabyInput): Promise<Session>;
  login(input: LoginInput): Promise<Session>;
  logout(session: Session): Promise<void>;
  /** Events changed after `since` (ISO), oldest change first, at most `limit`. Includes tombstones. */
  listEvents(session: Session, since: string | null, limit: number): Promise<BabyEvent[]>;
  upsertEvents(session: Session, events: BabyEvent[]): Promise<void>;
  /** Realtime nudge: calls onChange when another device pushed changes. Returns an unsubscribe fn. */
  subscribe(babyId: string, onChange: () => void): () => void;
  /** Tells other devices that this device pushed changes. */
  notify(babyId: string): void;
}

let cached: Backend | null = null;

export function getBackend(): Backend {
  if (!cached) {
    cached = isSupabaseConfigured && supabase ? createSupabaseBackend(supabase) : createLocalBackend();
  }
  return cached;
}
