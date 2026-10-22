import { Droplet, Droplets, Milk, Moon, Pill, Sun, Toilet } from 'lucide-react';
import type { ComponentType } from 'react';
import type { BabyEvent, EventType } from '../types';
import { buildSleepIntervals, countInRange, currentSleepStart, lastOfTypes } from '../utils/stats';
import { formatDuration, formatSince, startOfLocalDay, startOfNextLocalDay } from '../utils/time';

export type ActionKey = 'milk' | 'urine' | 'potty' | 'both' | 'sleep' | 'medicine';

interface ActionConfig {
  label: string;
  bg: string;
  /** Event types that count as this action for "last" and "today" stats. */
  types: readonly EventType[];
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const ACTIONS: Record<ActionKey, ActionConfig> = {
  milk: { label: 'Milk', bg: 'bg-milk', types: ['milk'], icon: Milk },
  urine: { label: 'Urine', bg: 'bg-urine', types: ['urine', 'both'], icon: Droplet },
  potty: { label: 'Potty', bg: 'bg-potty', types: ['potty', 'both'], icon: Toilet },
  both: { label: 'Both', bg: 'bg-both', types: ['both'], icon: Droplets },
  sleep: { label: 'Sleep', bg: 'bg-sleep', types: ['sleep_start', 'sleep_end'], icon: Moon },
  medicine: { label: 'Medicine', bg: 'bg-med', types: ['medicine'], icon: Pill },
};

/** Display order: the three primary buttons first, then the combo and secondary actions. */
const ORDER: ActionKey[] = ['milk', 'urine', 'potty', 'both', 'sleep', 'medicine'];

interface ActionGridProps {
  events: readonly BabyEvent[];
  now: number;
  onTap: (key: ActionKey) => void;
}

export function ActionGrid({ events, now, onTap }: ActionGridProps) {
  // `now` refreshes every 15s, so it can lag a tap made a moment ago. Counts therefore use the
  // whole local day rather than "up to now", and elapsed times are clamped at zero.
  const dayStart = startOfLocalDay(now);
  const dayEnd = startOfNextLocalDay(dayStart);
  const sleepIntervals = buildSleepIntervals(events);
  const sleepingSince = currentSleepStart(sleepIntervals);
  const lastAwakeAt = lastOfTypes(events, ['sleep_end']);
  const elapsed = (since: number) => Math.max(0, now - since);

  function describe(key: ActionKey): { subtitle: string; count: number } {
    if (key === 'sleep') {
      const count = sleepIntervals.filter((i) => i.startMs >= dayStart && i.startMs < dayEnd).length;
      if (sleepingSince !== null) return { subtitle: `Asleep ${formatDuration(elapsed(sleepingSince))}`, count };
      if (lastAwakeAt !== null) return { subtitle: `Awake ${formatDuration(elapsed(lastAwakeAt))}`, count };
      return { subtitle: 'Tap when asleep', count };
    }
    const types = ACTIONS[key].types;
    const last = lastOfTypes(events, types);
    return {
      subtitle: last === null ? 'None yet' : formatSince(elapsed(last)),
      count: countInRange(events, types, dayStart, dayEnd),
    };
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {ORDER.map((key) => {
        const { label, bg, icon: Icon } = ACTIONS[key];
        const { subtitle, count } = describe(key);
        // The sleep card shows the action a tap will perform: "Sleep" when awake, "Wake up" when asleep.
        const isAsleep = key === 'sleep' && sleepingSince !== null;
        const Glyph = isAsleep ? Sun : Icon;
        const displayLabel = key === 'sleep' ? (isAsleep ? 'Wake up' : 'Sleep') : label;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTap(key)}
            aria-label={`${displayLabel}. ${subtitle}. ${count} today`}
            className={`${bg} flex min-h-36 flex-col justify-between rounded-3xl p-4 text-left text-on-action shadow-sm transition-transform active:scale-95`}
          >
            <div className="flex w-full items-start justify-between">
              <Glyph className="size-9" strokeWidth={2.2} />
              <span className="rounded-full bg-black/20 px-2.5 py-0.5 text-xs font-semibold">{count} today</span>
            </div>
            <div>
              <div className="text-xl font-bold leading-tight">{displayLabel}</div>
              <div className="mt-0.5 text-sm opacity-90">{subtitle}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
