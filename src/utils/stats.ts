import type { BabyEvent, EventType } from '../types';
import { parseTimestamp } from './time';

/** Which event types count toward each button and each summary card. Both counts as wet and dirty. */
export const WET_TYPES: readonly EventType[] = ['urine', 'both'];
export const DIRTY_TYPES: readonly EventType[] = ['potty', 'both'];

export interface SleepInterval {
  startMs: number;
  /** null while the baby is still asleep. */
  endMs: number | null;
}

/** Pairs sleep_start and sleep_end into intervals. Unpaired taps are ignored. */
export function buildSleepIntervals(events: readonly BabyEvent[]): SleepInterval[] {
  const sleepEvents = events
    .filter((e) => !e.deleted && (e.type === 'sleep_start' || e.type === 'sleep_end'))
    .map((e) => ({ type: e.type, t: parseTimestamp(e.occurredAt) }))
    .sort((a, b) => a.t - b.t);

  const intervals: SleepInterval[] = [];
  let open: SleepInterval | null = null;
  for (const e of sleepEvents) {
    if (e.type === 'sleep_start') {
      if (open) continue;
      open = { startMs: e.t, endMs: null };
      intervals.push(open);
    } else if (open) {
      open.endMs = e.t;
      open = null;
    }
  }
  return intervals;
}

export function currentSleepStart(intervals: readonly SleepInterval[]): number | null {
  const last = intervals[intervals.length - 1];
  return last && last.endMs === null ? last.startMs : null;
}

/** Latest event time of the given types, or null if there is none. */
export function lastOfTypes(events: readonly BabyEvent[], types: readonly EventType[]): number | null {
  let latest: number | null = null;
  for (const e of events) {
    if (e.deleted || !types.includes(e.type)) continue;
    const t = parseTimestamp(e.occurredAt);
    if (latest === null || t > latest) latest = t;
  }
  return latest;
}

export function countInRange(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  startMs: number,
  endMs: number,
): number {
  let n = 0;
  for (const e of events) {
    if (e.deleted || !types.includes(e.type)) continue;
    const t = parseTimestamp(e.occurredAt);
    if (t >= startMs && t < endMs) n++;
  }
  return n;
}

export interface DaySummary {
  milkFeeds: number;
  milkMl: number;
  wetDiapers: number;
  dirtyDiapers: number;
  sleepMs: number;
  medicineDoses: number;
  /** Average gap between consecutive feeds within the day, or null with fewer than two feeds. */
  avgFeedGapMs: number | null;
}

/** Totals for [dayStartMs, dayEndMs). An open sleep counts up to `nowMs`. */
export function summarizeDay(
  events: readonly BabyEvent[],
  dayStartMs: number,
  dayEndMs: number,
  nowMs: number,
): DaySummary {
  const inDay = events.filter((e) => {
    if (e.deleted) return false;
    const t = parseTimestamp(e.occurredAt);
    return t >= dayStartMs && t < dayEndMs;
  });

  const feedTimes = inDay
    .filter((e) => e.type === 'milk')
    .map((e) => parseTimestamp(e.occurredAt))
    .sort((a, b) => a - b);

  let avgFeedGapMs: number | null = null;
  if (feedTimes.length >= 2) {
    let total = 0;
    for (let i = 1; i < feedTimes.length; i++) total += feedTimes[i] - feedTimes[i - 1];
    avgFeedGapMs = total / (feedTimes.length - 1);
  }

  let sleepMs = 0;
  for (const interval of buildSleepIntervals(events)) {
    const end = Math.min(interval.endMs ?? nowMs, dayEndMs);
    const start = Math.max(interval.startMs, dayStartMs);
    if (end > start) sleepMs += end - start;
  }

  return {
    milkFeeds: feedTimes.length,
    milkMl: inDay.reduce((sum, e) => sum + (e.type === 'milk' ? (e.details.amountMl ?? 0) : 0), 0),
    wetDiapers: inDay.filter((e) => WET_TYPES.includes(e.type)).length,
    dirtyDiapers: inDay.filter((e) => DIRTY_TYPES.includes(e.type)).length,
    sleepMs,
    medicineDoses: inDay.filter((e) => e.type === 'medicine').length,
    avgFeedGapMs,
  };
}
