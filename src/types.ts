export type EventType =
  | 'milk'
  | 'urine'
  | 'potty'
  | 'both'
  | 'sleep_start'
  | 'sleep_end'
  | 'medicine';

export const EVENT_LABELS: Record<EventType, string> = {
  milk: 'Milk',
  urine: 'Urine',
  potty: 'Potty',
  both: 'Both',
  sleep_start: 'Asleep',
  sleep_end: 'Awake',
  medicine: 'Medicine',
};

/** Optional quick-tap details. Every field is optional, so logging never needs typing. */
export interface EventDetails {
  /** Chip text such as "90 ml", "Breast L", "Heavy", "Crib", "Vit D". */
  label?: string;
  /** Feed volume in millilitres, used for the daily ml total. */
  amountMl?: number;
}

export interface BabyEvent {
  /** Generated on the device, so offline writes are idempotent. */
  id: string;
  babyId: string;
  type: EventType;
  /** When it happened in ISO format. Can be backdated. */
  occurredAt: string;
  details: EventDetails;
  deviceLabel: string;
  /** Tombstone so deletes propagate to other devices. */
  deleted: boolean;
  /** Server clock. Null until the server has accepted the event. */
  updatedAt: string | null;
}

export type BackendMode = 'supabase' | 'local';

export interface Session {
  mode: BackendMode;
  babyId: string;
  babyName: string;
  token: string;
  deviceLabel: string;
}
