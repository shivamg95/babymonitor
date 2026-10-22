import { useState } from 'react';
import type { BabyEvent, EventType } from '../types';
import { nextSleepType } from '../utils/cooldown';
import { HOUR_MS, MINUTE_MS } from '../utils/time';
import { ACTIONS, type ActionKey } from './ActionGrid';
import { Sheet } from './Sheet';

const CUSTOM = 'custom';

const PRESETS: Array<{ id: string; label: string; offsetMs: number }> = [
  { id: '10m', label: '10 min ago', offsetMs: 10 * MINUTE_MS },
  { id: '15m', label: '15 min ago', offsetMs: 15 * MINUTE_MS },
  { id: '30m', label: '30 min ago', offsetMs: 30 * MINUTE_MS },
  { id: '1h', label: '1 hour ago', offsetMs: HOUR_MS },
];

const BUTTON_KEYS: ActionKey[] = ['milk', 'urine', 'potty', 'both', 'sleep', 'medicine'];

/** Local time in the format a datetime-local input expects. */
function toDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface BackdateModalProps {
  events: readonly BabyEvent[];
  onAttempt: (type: EventType, atMs: number) => void;
  onClose: () => void;
}

/** For logging something that happened earlier, such as a feed you forgot to tap at the time. */
export function BackdateModal({ events, onAttempt, onClose }: BackdateModalProps) {
  const [choice, setChoice] = useState('15m');
  const [custom, setCustom] = useState(() => toDateTimeLocal(Date.now() - 15 * MINUTE_MS));
  const [error, setError] = useState<string | null>(null);

  /** Returns the chosen time as epoch ms, or null if it is invalid (for example, in the future). */
  function resolveTime(): number | null {
    const now = Date.now();
    if (choice === CUSTOM) {
      const ms = new Date(custom).getTime();
      if (Number.isNaN(ms) || ms > now) return null;
      return ms;
    }
    const preset = PRESETS.find((p) => p.id === choice);
    return now - (preset?.offsetMs ?? 0);
  }

  const previewMs = resolveTime() ?? Date.now();
  const sleepLabel = nextSleepType(events, previewMs) === 'sleep_end' ? 'Wake up' : 'Sleep';

  function log(key: ActionKey) {
    const atMs = resolveTime();
    if (atMs === null) {
      setError('Pick a time that is not in the future.');
      return;
    }
    // Sleep is a toggle, so its direction depends on the state at the chosen time.
    const type: EventType = key === 'sleep' ? nextSleepType(events, atMs) : key;
    onAttempt(type, atMs);
  }

  const chipClass = (selected: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm font-medium ${
      selected ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface-2 text-ink'
    }`;

  return (
    <Sheet title="Log a past time" onClose={onClose}>
      <p className="mb-2 text-sm text-muted">When did it happen?</p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={choice === p.id}
            onClick={() => {
              setChoice(p.id);
              setError(null);
            }}
            className={chipClass(choice === p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={choice === CUSTOM}
          onClick={() => {
            setChoice(CUSTOM);
            setError(null);
          }}
          className={chipClass(choice === CUSTOM)}
        >
          Pick time
        </button>
      </div>

      {choice === CUSTOM && (
        <input
          type="datetime-local"
          aria-label="Time it happened"
          value={custom}
          max={toDateTimeLocal(Date.now())}
          onChange={(e) => {
            setCustom(e.target.value);
            setError(null);
          }}
          className="mt-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink"
        />
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="mt-5 grid grid-cols-3 gap-2">
        {BUTTON_KEYS.map((key) => {
          const label = key === 'sleep' ? sleepLabel : ACTIONS[key].label;
          return (
            <button
              key={key}
              type="button"
              onClick={() => log(key)}
              className={`${ACTIONS[key].bg} rounded-2xl py-3.5 text-sm font-semibold text-on-action active:scale-95`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
