export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Parses an ISO timestamp. Postgres sends microseconds (".123456"), which Safari fails
 * to parse, so anything past milliseconds is trimmed first.
 */
export function parseTimestamp(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
}

/** "42 seconds", "3 min", "1h 5m". Used in the duplicate prompt. */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, ms);
  if (abs < MINUTE_MS) {
    const s = Math.floor(abs / 1000);
    return s === 1 ? '1 second' : `${s} seconds`;
  }
  if (abs < HOUR_MS) return `${Math.floor(abs / MINUTE_MS)} min`;
  const h = Math.floor(abs / HOUR_MS);
  const m = Math.floor((abs % HOUR_MS) / MINUTE_MS);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Badge text such as "just now", "12m ago", "1h 45m ago". */
export function formatSince(ms: number): string {
  if (ms < MINUTE_MS) return 'just now';
  return `${formatDuration(ms)} ago`;
}

/** Local clock time, for example "10:14 AM". */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Start of the local calendar day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Start of the next local calendar day. Handles DST, which a fixed 24h step would not. */
export function startOfNextLocalDay(dayStartMs: number): number {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Moves a local day-start by whole days (negative = earlier). */
export function shiftDay(dayStartMs: number, days: number): number {
  let d = dayStartMs;
  for (let i = 0; i < Math.abs(days); i++) {
    d = days > 0 ? startOfNextLocalDay(d) : startOfLocalDay(d - 1);
  }
  return d;
}
