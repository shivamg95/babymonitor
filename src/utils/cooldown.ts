import type { BabyEvent, EventType } from '../types';
import { MINUTE_MS, parseTimestamp } from './time';

/**
 * Duplicate guard. A tap that lands within the window of a matching earlier entry
 * asks the user to confirm before it is saved. Nothing is blocked outright.
 */
export const DUPLICATE_WINDOWS_MS = {
  milk: 2 * MINUTE_MS,
  urine: 2 * MINUTE_MS,
  potty: 3 * MINUTE_MS,
  sleep: 2 * MINUTE_MS,
  medicine: 30 * MINUTE_MS,
} as const;

interface GuardRule {
  /** Which earlier event types count as a duplicate for this rule. */
  matches: (type: EventType) => boolean;
  windowMs: number;
}

const URINE_RULE: GuardRule = {
  matches: (t) => t === 'urine' || t === 'both',
  windowMs: DUPLICATE_WINDOWS_MS.urine,
};

const POTTY_RULE: GuardRule = {
  matches: (t) => t === 'potty' || t === 'both',
  windowMs: DUPLICATE_WINDOWS_MS.potty,
};

const SLEEP_RULE: GuardRule = {
  matches: (t) => t === 'sleep_start' || t === 'sleep_end',
  windowMs: DUPLICATE_WINDOWS_MS.sleep,
};

/**
 * Both (urine + potty) is checked against each half separately. It is a duplicate if
 * a urine-type entry is within 2 min OR a potty-type entry is within 3 min.
 */
const RULES: Record<EventType, GuardRule[]> = {
  milk: [{ matches: (t) => t === 'milk', windowMs: DUPLICATE_WINDOWS_MS.milk }],
  urine: [URINE_RULE],
  potty: [POTTY_RULE],
  both: [URINE_RULE, POTTY_RULE],
  sleep_start: [SLEEP_RULE],
  sleep_end: [SLEEP_RULE],
  medicine: [{ matches: (t) => t === 'medicine', windowMs: DUPLICATE_WINDOWS_MS.medicine }],
};

export const EVENT_NOUN: Record<EventType, string> = {
  milk: 'Milk',
  urine: 'Urine',
  potty: 'Potty',
  both: 'Both',
  sleep_start: 'Sleep',
  sleep_end: 'Wake-up',
  medicine: 'Medicine',
};

export interface DuplicateWarning {
  /** What the user is trying to log. */
  type: EventType;
  /** The closest conflicting entry. */
  previous: BabyEvent;
  previousAtMs: number;
  /** Absolute gap between the new entry and the previous one. */
  gapMs: number;
  /** "ago" when the previous entry is earlier, "later" when it is after the new time (backdating). */
  relation: 'ago' | 'later';
  windowMs: number;
}

/**
 * Returns the closest matching entry inside its window, or null if the entry is safe to log.
 * `atMs` is the time being logged (now, or a backdated time).
 */
export function getDuplicateWarning(
  type: EventType,
  events: readonly BabyEvent[],
  atMs: number,
): DuplicateWarning | null {
  let best: DuplicateWarning | null = null;

  for (const rule of RULES[type]) {
    for (const event of events) {
      if (event.deleted || !rule.matches(event.type)) continue;
      const previousAtMs = parseTimestamp(event.occurredAt);
      const gapMs = Math.abs(atMs - previousAtMs);
      if (gapMs >= rule.windowMs) continue;
      if (best && gapMs >= best.gapMs) continue;
      best = {
        type,
        previous: event,
        previousAtMs,
        gapMs,
        relation: previousAtMs <= atMs ? 'ago' : 'later',
        windowMs: rule.windowMs,
      };
    }
  }

  return best;
}

/**
 * Sleep is a toggle. Returns the type a tap should log at `atMs`, based on the latest
 * sleep event at or before that time. Nothing logged yet means awake, so the next tap is "asleep".
 */
export function nextSleepType(events: readonly BabyEvent[], atMs: number): 'sleep_start' | 'sleep_end' {
  let latest: BabyEvent | null = null;
  let latestMs = -Infinity;
  for (const event of events) {
    if (event.deleted || (event.type !== 'sleep_start' && event.type !== 'sleep_end')) continue;
    const t = parseTimestamp(event.occurredAt);
    if (t > atMs || t < latestMs) continue;
    latest = event;
    latestMs = t;
  }
  return latest?.type === 'sleep_start' ? 'sleep_end' : 'sleep_start';
}
