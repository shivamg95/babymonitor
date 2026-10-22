import { useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { EVENT_LABELS, type BabyEvent, type EventDetails, type EventType } from '../types';
import { formatClock, parseTimestamp } from '../utils/time';

const TOAST_MS = 6_000;

interface Chip {
  label: string;
  patch: EventDetails;
}

const labelChip = (label: string): Chip => ({ label, patch: { label } });
const consistencyChips: Chip[] = ['Light', 'Medium', 'Heavy'].map(labelChip);

/** Optional one-tap details. Nothing here is required to log. */
const CHIPS: Partial<Record<EventType, Chip[]>> = {
  milk: [
    { label: '60 ml', patch: { label: '60 ml', amountMl: 60 } },
    { label: '90 ml', patch: { label: '90 ml', amountMl: 90 } },
    { label: '120 ml', patch: { label: '120 ml', amountMl: 120 } },
    { label: '150 ml', patch: { label: '150 ml', amountMl: 150 } },
    { label: 'Breast L', patch: { label: 'Breast L', amountMl: undefined } },
    { label: 'Breast R', patch: { label: 'Breast R', amountMl: undefined } },
  ],
  urine: consistencyChips,
  potty: consistencyChips,
  both: consistencyChips,
  medicine: ['Vit D', 'Drops', 'Fever Med'].map(labelChip),
  sleep_start: ['Crib', 'Contact Nap'].map(labelChip),
};

interface PostLogToastProps {
  event: BabyEvent | null;
  onUndo: () => void;
  onChip: (patch: EventDetails) => void;
  onDismiss: () => void;
}

/** Undo plus optional detail chips for the entry just logged. Auto-dismisses after 6s without interaction. */
export function PostLogToast({ event, onUndo, onChip, onDismiss }: PostLogToastProps) {
  const [interactions, setInteractions] = useState(0);
  // A ref keeps the timer from restarting every time the parent re-renders with a new callback.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const eventId = event?.id;
  useEffect(() => {
    if (!eventId) return;
    const timer = window.setTimeout(() => dismissRef.current(), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [eventId, interactions]);

  if (!event) return null;

  const chips = CHIPS[event.type] ?? [];
  const selectedLabel = event.details.label;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 z-40 mx-auto w-[calc(100%-1.5rem)] max-w-md rounded-2xl border border-line bg-surface p-3 shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{EVENT_LABELS[event.type]} logged</div>
          <div className="truncate text-sm text-muted">
            {formatClock(parseTimestamp(event.occurredAt))} · {event.deviceLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={onUndo}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-sm font-semibold text-ink"
        >
          <Undo2 className="size-4" aria-hidden="true" />
          Undo
        </button>
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => {
            const selected = selectedLabel === chip.label;
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onChip(chip.patch);
                  setInteractions((n) => n + 1);
                }}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  selected ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface-2 text-ink'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
