import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../types';
import { buildSleepIntervals, countInRange, lastOfTypes, summarizeDay } from './stats';

const DAY_START = Date.UTC(2026, 9, 20, 0, 0, 0);
const DAY_END = DAY_START + 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function at(type: EventType, ms: number, overrides: Partial<BabyEvent> = {}): BabyEvent {
  return {
    id: `${type}-${ms}-${Math.random()}`,
    babyId: 'leo-2026',
    type,
    occurredAt: new Date(ms).toISOString(),
    details: {},
    deviceLabel: 'Phone',
    deleted: false,
    updatedAt: null,
    ...overrides,
  };
}

describe('buildSleepIntervals', () => {
  it('pairs start and end taps and keeps an open sleep', () => {
    const intervals = buildSleepIntervals([
      at('sleep_start', DAY_START + 1 * HOUR),
      at('sleep_end', DAY_START + 2 * HOUR),
      at('sleep_start', DAY_START + 5 * HOUR),
    ]);
    expect(intervals).toEqual([
      { startMs: DAY_START + 1 * HOUR, endMs: DAY_START + 2 * HOUR },
      { startMs: DAY_START + 5 * HOUR, endMs: null },
    ]);
  });

  it('ignores an orphan wake-up and a duplicate start', () => {
    const intervals = buildSleepIntervals([
      at('sleep_end', DAY_START + 1 * HOUR),
      at('sleep_start', DAY_START + 2 * HOUR),
      at('sleep_start', DAY_START + 3 * HOUR),
      at('sleep_end', DAY_START + 4 * HOUR),
    ]);
    expect(intervals).toEqual([{ startMs: DAY_START + 2 * HOUR, endMs: DAY_START + 4 * HOUR }]);
  });
});

describe('summarizeDay', () => {
  const now = DAY_START + 12 * HOUR;

  it('totals feeds, ml, diapers, medicine and average feed gap', () => {
    const events: BabyEvent[] = [
      at('milk', DAY_START + 1 * HOUR, { details: { amountMl: 90 } }),
      at('milk', DAY_START + 4 * HOUR, { details: { amountMl: 120 } }),
      at('milk', DAY_START + 7 * HOUR), // no ml recorded
      at('urine', DAY_START + 2 * HOUR),
      at('both', DAY_START + 3 * HOUR),
      at('potty', DAY_START + 5 * HOUR),
      at('medicine', DAY_START + 6 * HOUR),
    ];

    const s = summarizeDay(events, DAY_START, DAY_END, now);
    expect(s.milkFeeds).toBe(3);
    expect(s.milkMl).toBe(210);
    expect(s.wetDiapers).toBe(2); // urine + both
    expect(s.dirtyDiapers).toBe(2); // potty + both
    expect(s.medicineDoses).toBe(1);
    // Gaps: 3h then 3h, average 3h.
    expect(s.avgFeedGapMs).toBe(3 * HOUR);
  });

  it('gives a null average with fewer than two feeds', () => {
    expect(summarizeDay([at('milk', DAY_START + HOUR)], DAY_START, DAY_END, now).avgFeedGapMs).toBeNull();
  });

  it('counts sleep, clipping an open sleep to now', () => {
    const events = [
      at('sleep_start', DAY_START + 1 * HOUR),
      at('sleep_end', DAY_START + 2.5 * HOUR), // 1.5h
      at('sleep_start', DAY_START + 10 * HOUR), // open, runs until now (12:00) = 2h
    ];
    expect(summarizeDay(events, DAY_START, DAY_END, now).sleepMs).toBe(3.5 * HOUR);
  });

  it('only counts the part of a sleep that falls inside the day', () => {
    const events = [
      at('sleep_start', DAY_START - 1 * HOUR),
      at('sleep_end', DAY_START + 1 * HOUR), // 1h inside the day
    ];
    expect(summarizeDay(events, DAY_START, DAY_END, now).sleepMs).toBe(1 * HOUR);
  });

  it('excludes events outside the day and deleted events', () => {
    const events = [
      at('milk', DAY_START - 1000, { details: { amountMl: 500 } }),
      at('milk', DAY_START + 1 * HOUR, { details: { amountMl: 60 } }),
      at('milk', DAY_START + 2 * HOUR, { details: { amountMl: 999 }, deleted: true }),
    ];
    const s = summarizeDay(events, DAY_START, DAY_END, now);
    expect(s.milkFeeds).toBe(1);
    expect(s.milkMl).toBe(60);
  });
});

describe('small helpers', () => {
  const events = [at('urine', 1000), at('both', 2000), at('potty', 3000, { deleted: true })];

  it('lastOfTypes returns the newest live match', () => {
    expect(lastOfTypes(events, ['urine', 'both'])).toBe(2000);
    expect(lastOfTypes(events, ['potty'])).toBeNull();
  });

  it('countInRange respects the half-open range and skips deleted events', () => {
    expect(countInRange(events, ['urine', 'both', 'potty'], 0, 3000)).toBe(2);
  });
});
