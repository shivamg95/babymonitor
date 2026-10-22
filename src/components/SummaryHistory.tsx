import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { EVENT_LABELS, type BabyEvent } from '../types';
import { summarizeDay } from '../utils/stats';
import { formatClock, formatDuration, parseTimestamp, shiftDay, startOfLocalDay, startOfNextLocalDay } from '../utils/time';

interface SummaryHistoryProps {
  events: readonly BabyEvent[];
  now: number;
  onDelete: (id: string) => void;
}

function dayTitle(dayStart: number, now: number): string {
  const today = startOfLocalDay(now);
  if (dayStart === today) return 'Today';
  if (dayStart === shiftDay(today, -1)) return 'Yesterday';
  return new Date(dayStart).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function Card({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-tight">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
    </div>
  );
}

/** Daily totals for a doctor visit, plus a timeline with delete. Navigable by day. */
export function SummaryHistory({ events, now, onDelete }: SummaryHistoryProps) {
  const [daysBack, setDaysBack] = useState(0);
  const [armedId, setArmedId] = useState<string | null>(null);

  const dayStart = shiftDay(startOfLocalDay(now), -daysBack);
  const dayEnd = startOfNextLocalDay(dayStart);
  const s = summarizeDay(events, dayStart, dayEnd, now);

  const dayEvents = events
    .filter((e) => {
      const t = parseTimestamp(e.occurredAt);
      return t >= dayStart && t < dayEnd;
    })
    .sort((a, b) => parseTimestamp(b.occurredAt) - parseTimestamp(a.occurredAt));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-2xl bg-surface p-2">
        <button
          type="button"
          onClick={() => setDaysBack((d) => d + 1)}
          aria-label="Previous day"
          className="rounded-xl p-2 text-ink"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="text-center">
          <div className="font-semibold">{dayTitle(dayStart, now)}</div>
          <div className="text-xs text-muted">{new Date(dayStart).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <button
          type="button"
          onClick={() => setDaysBack((d) => Math.max(0, d - 1))}
          disabled={daysBack === 0}
          aria-label="Next day"
          className="rounded-xl p-2 text-ink"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card
          label="Feeds"
          value={s.milkFeeds}
          sub={s.milkMl > 0 ? `${s.milkMl} ml total` : 'no ml logged'}
        />
        <Card
          label="Avg feed gap"
          value={s.avgFeedGapMs !== null ? formatDuration(s.avgFeedGapMs) : '-'}
          sub="between feeds"
        />
        <Card label="Wet diapers" value={s.wetDiapers} sub="urine + both" />
        <Card label="Dirty diapers" value={s.dirtyDiapers} sub="potty + both" />
        <Card label="Asleep" value={formatDuration(s.sleepMs)} sub="total sleep" />
        <Card label="Medicine" value={s.medicineDoses} sub="doses" />
      </div>

      <div>
        <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Timeline</h2>
        {dayEvents.length === 0 ? (
          <p className="rounded-2xl bg-surface p-4 text-center text-sm text-muted">Nothing logged for this day.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl bg-surface">
            {dayEvents.map((e) => {
              const detail = [e.details.label, e.details.amountMl && !e.details.label ? `${e.details.amountMl} ml` : null]
                .filter(Boolean)
                .join(' · ');
              const armed = armedId === e.id;
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-16 shrink-0 font-mono text-sm text-muted">{formatClock(parseTimestamp(e.occurredAt))}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{EVENT_LABELS[e.type]}</div>
                    <div className="truncate text-xs text-muted">
                      {[detail, e.deviceLabel].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (armed) {
                        onDelete(e.id);
                        setArmedId(null);
                      } else {
                        setArmedId(e.id);
                      }
                    }}
                    onBlur={() => setArmedId((id) => (id === e.id ? null : id))}
                    aria-label={armed ? `Confirm delete ${EVENT_LABELS[e.type]}` : `Delete ${EVENT_LABELS[e.type]}`}
                    className={`rounded-xl px-2.5 py-2 text-xs font-semibold ${
                      armed ? 'bg-danger text-on-accent' : 'text-muted'
                    }`}
                  >
                    {armed ? 'Delete?' : <Trash2 className="size-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
