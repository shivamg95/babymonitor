import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Backend, CreateBabyInput, LoginInput } from './backend';
import { BackendError, backendErrorFromMessage } from './errors';
import type { BabyEvent, EventDetails, EventType, Session } from '../types';
import { parseTimestamp } from '../utils/time';

/** Row shape returned by the bm_* functions (snake_case, matches the Postgres columns). */
interface EventRow {
  id: string;
  baby_id: string;
  type: EventType;
  occurred_at: string;
  details: EventDetails | null;
  device_label: string | null;
  deleted: boolean;
  updated_at: string;
}

interface SessionPayload {
  token?: string;
  babyId?: string;
  babyName?: string;
}

function toBabyEvent(row: EventRow): BabyEvent {
  return {
    id: row.id,
    babyId: row.baby_id,
    type: row.type,
    occurredAt: new Date(parseTimestamp(row.occurred_at)).toISOString(),
    details: row.details ?? {},
    deviceLabel: row.device_label ?? 'Device',
    deleted: row.deleted,
    updatedAt: new Date(parseTimestamp(row.updated_at)).toISOString(),
  };
}

function toWire(event: BabyEvent) {
  return {
    id: event.id,
    type: event.type,
    occurred_at: event.occurredAt,
    details: event.details,
    device_label: event.deviceLabel,
    deleted: event.deleted,
  };
}

function sessionFrom(payload: unknown, deviceLabel: string): Session {
  const p = payload as SessionPayload | null;
  if (!p?.token || !p.babyId) throw new BackendError('unknown', 'Unexpected server response');
  return {
    mode: 'supabase',
    babyId: p.babyId,
    babyName: p.babyName ?? p.babyId,
    token: p.token,
    deviceLabel,
  };
}

export function createSupabaseBackend(client: SupabaseClient): Backend {
  const channels = new Map<string, RealtimeChannel>();

  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let result: { data: unknown; error: { message: string } | null };
    try {
      result = await client.rpc(fn, args);
    } catch (err) {
      throw new BackendError('network', String(err));
    }
    if (result.error) throw backendErrorFromMessage(result.error.message);
    return result.data as T;
  }

  return {
    mode: 'supabase',

    async createBaby(input: CreateBabyInput): Promise<Session> {
      const data = await call<unknown>('bm_create_baby', {
        p_baby_id: input.babyId,
        p_baby_name: input.babyName,
        p_password: input.password,
        p_device_label: input.deviceLabel,
      });
      return sessionFrom(data, input.deviceLabel);
    },

    async login(input: LoginInput): Promise<Session> {
      const data = await call<unknown>('bm_login', {
        p_baby_id: input.babyId,
        p_password: input.password,
        p_device_label: input.deviceLabel,
      });
      return sessionFrom(data, input.deviceLabel);
    },

    async logout(session: Session): Promise<void> {
      try {
        await call('bm_logout', { p_token: session.token });
      } catch {
        // Best effort. The local session is cleared either way.
      }
    },

    async listEvents(session, since, limit) {
      const rows = await call<EventRow[] | null>('bm_list_events', {
        p_token: session.token,
        p_since: since,
        p_limit: limit,
      });
      return (rows ?? []).map(toBabyEvent);
    },

    async upsertEvents(session, events) {
      if (events.length === 0) return;
      await call('bm_upsert_events', {
        p_token: session.token,
        p_events: events.map(toWire),
      });
    },

    subscribe(babyId, onChange) {
      const channel = client
        .channel(`baby:${babyId}`)
        .on('broadcast', { event: 'changed' }, () => onChange())
        .subscribe();
      channels.set(babyId, channel);
      return () => {
        if (channels.get(babyId) === channel) channels.delete(babyId);
        void client.removeChannel(channel);
      };
    },

    notify(babyId) {
      // The broadcast carries no data. It only tells other devices to pull.
      const channel = channels.get(babyId);
      if (!channel) return;
      void channel.send({ type: 'broadcast', event: 'changed', payload: {} });
    },
  };
}
