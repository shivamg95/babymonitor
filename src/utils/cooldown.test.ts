import { describe, expect, it } from 'vitest';
import type { BabyEvent, EventType } from '../types';
import { DUPLICATE_WINDOWS_MS, getDuplicateWarning, nextSleepType } from './cooldown';

const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;

/** Event that happened `agoMs` before NOW. */
function ev(type: EventType, agoMs: number, overrides: Partial<BabyEvent> = {}): BabyEvent {
  return {
    id: `${type}-${agoMs}-${Math.random()}`,
    babyId: 'leo-2026',
    type,
    occurredAt: new Date(NOW - agoMs).toISOString(),
    details: {},
    deviceLabel: 'Phone',
    deleted: false,
    updatedAt: null,
    ...overrides,
  };
}

describe('duplicate windows', () => {
  it('match the agreed thresholds', () => {
    expect(DUPLICATE_WINDOWS_MS.milk).toBe(2 * MIN);
    expect(DUPLICATE_WINDOWS_MS.urine).toBe(2 * MIN);
    expect(DUPLICATE_WINDOWS_MS.potty).toBe(3 * MIN);
    expect(DUPLICATE_WINDOWS_MS.sleep).toBe(2 * MIN);
    expect(DUPLICATE_WINDOWS_MS.medicine).toBe(30 * MIN);
  });
});

describe('getDuplicateWarning: milk', () => {
  it('warns when the last milk was under 2 minutes ago', () => {
    const warning = getDuplicateWarning('milk', [ev('milk', 119 * SEC)], NOW);
    expect(warning).not.toBeNull();
    expect(warning?.gapMs).toBe(119 * SEC);
    expect(warning?.relation).toBe('ago');
  });

  it('does not warn at exactly 2 minutes or later', () => {
    expect(getDuplicateWarning('milk', [ev('milk', 2 * MIN)], NOW)).toBeNull();
    expect(getDuplicateWarning('milk', [ev('milk', 5 * MIN)], NOW)).toBeNull();
  });

  it('ignores other event types', () => {
    expect(getDuplicateWarning('milk', [ev('urine', 10 * SEC), ev('potty', 10 * SEC)], NOW)).toBeNull();
  });
});

describe('getDuplicateWarning: urine', () => {
  it('warns within 2 minutes of a urine entry', () => {
    expect(getDuplicateWarning('urine', [ev('urine', 60 * SEC)], NOW)?.previous.type).toBe('urine');
  });

  it('counts a Both entry as urine too', () => {
    expect(getDuplicateWarning('urine', [ev('both', 60 * SEC)], NOW)?.previous.type).toBe('both');
  });

  it('does not count potty entries', () => {
    expect(getDuplicateWarning('urine', [ev('potty', 10 * SEC)], NOW)).toBeNull();
  });
});

describe('getDuplicateWarning: potty', () => {
  it('warns within 3 minutes, which is longer than urine', () => {
    expect(getDuplicateWarning('potty', [ev('potty', 2.5 * MIN)], NOW)).not.toBeNull();
    expect(getDuplicateWarning('potty', [ev('potty', 3 * MIN)], NOW)).toBeNull();
  });

  it('counts a Both entry as potty too, and ignores urine', () => {
    expect(getDuplicateWarning('potty', [ev('both', 2 * MIN)], NOW)?.previous.type).toBe('both');
    expect(getDuplicateWarning('potty', [ev('urine', 10 * SEC)], NOW)).toBeNull();
  });
});

describe('getDuplicateWarning: both', () => {
  it('warns when urine was logged within 2 minutes', () => {
    expect(getDuplicateWarning('both', [ev('urine', 90 * SEC)], NOW)?.previous.type).toBe('urine');
  });

  it('warns when potty was logged within 3 minutes, even if urine was not', () => {
    expect(getDuplicateWarning('both', [ev('potty', 150 * SEC)], NOW)?.previous.type).toBe('potty');
    expect(getDuplicateWarning('both', [ev('potty', 210 * SEC)], NOW)).toBeNull();
  });

  it('does not warn when urine is older than 2 minutes and potty is older than 3 minutes', () => {
    expect(getDuplicateWarning('both', [ev('urine', 150 * SEC), ev('potty', 210 * SEC)], NOW)).toBeNull();
  });

  it('reports the closest conflicting entry', () => {
    const warning = getDuplicateWarning('both', [ev('urine', 90 * SEC), ev('potty', 30 * SEC)], NOW);
    expect(warning?.previous.type).toBe('potty');
    expect(warning?.gapMs).toBe(30 * SEC);
  });
});

describe('getDuplicateWarning: medicine and sleep', () => {
  it('guards medicine for 30 minutes to prevent double dosing', () => {
    expect(getDuplicateWarning('medicine', [ev('medicine', 20 * MIN)], NOW)).not.toBeNull();
    expect(getDuplicateWarning('medicine', [ev('medicine', 30 * MIN)], NOW)).toBeNull();
  });

  it('guards sleep toggles for 2 minutes, whichever direction the last one was', () => {
    expect(getDuplicateWarning('sleep_end', [ev('sleep_start', 60 * SEC)], NOW)).not.toBeNull();
    expect(getDuplicateWarning('sleep_start', [ev('sleep_end', 60 * SEC)], NOW)).not.toBeNull();
    expect(getDuplicateWarning('sleep_start', [ev('sleep_end', 3 * MIN)], NOW)).toBeNull();
  });
});

describe('getDuplicateWarning: edge cases', () => {
  it('ignores deleted (undone) entries', () => {
    expect(getDuplicateWarning('milk', [ev('milk', 10 * SEC, { deleted: true })], NOW)).toBeNull();
  });

  it('treats an entry exactly 2 minutes away (in either direction) as safe', () => {
    // Existing milk is at NOW-1m. Backdating to NOW-3m puts the gap at exactly 2 min.
    expect(getDuplicateWarning('milk', [ev('milk', 1 * MIN)], NOW - 3 * MIN)).toBeNull();
  });

  it('reports "later" when backdating to just before an existing entry', () => {
    // Existing milk is at NOW. Backdating to NOW-1m is 1 min before it.
    const close = getDuplicateWarning('milk', [ev('milk', 0)], NOW - 1 * MIN);
    expect(close?.relation).toBe('later');
    expect(close?.gapMs).toBe(MIN);
  });
});

describe('nextSleepType', () => {
  it('starts with "asleep" when nothing was logged yet', () => {
    expect(nextSleepType([], NOW)).toBe('sleep_start');
  });

  it('alternates from the latest sleep event', () => {
    expect(nextSleepType([ev('sleep_start', 10 * MIN)], NOW)).toBe('sleep_end');
    expect(nextSleepType([ev('sleep_start', 20 * MIN), ev('sleep_end', 5 * MIN)], NOW)).toBe('sleep_start');
  });

  it('uses the state at the backdated time, not now', () => {
    const events = [ev('sleep_start', 60 * MIN), ev('sleep_end', 30 * MIN)];
    // 45 min ago the baby was asleep, so the next backdated tap is "awake".
    expect(nextSleepType(events, NOW - 45 * MIN)).toBe('sleep_end');
  });

  it('skips deleted sleep events', () => {
    expect(nextSleepType([ev('sleep_start', 5 * MIN, { deleted: true })], NOW)).toBe('sleep_start');
  });
});
