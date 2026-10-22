import type { DuplicateWarning } from '../utils/cooldown';
import { EVENT_NOUN } from '../utils/cooldown';
import { formatClock, formatDuration } from '../utils/time';
import { Sheet } from './Sheet';

interface DuplicateConfirmModalProps {
  warning: DuplicateWarning;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Shown when a tap lands inside a duplicate window. Cancel is the default, so a stray double-tap is safe. */
export function DuplicateConfirmModal({ warning, onCancel, onConfirm }: DuplicateConfirmModalProps) {
  const previousNoun = EVENT_NOUN[warning.previous.type];
  const newNoun = EVENT_NOUN[warning.type];
  const when = warning.relation === 'ago' ? 'ago' : 'after this time';
  const device = warning.previous.deviceLabel ? ` on ${warning.previous.deviceLabel}` : '';

  return (
    <Sheet title="Possible duplicate" onClose={onCancel}>
      <p className="text-base leading-relaxed">
        {previousNoun} was logged {formatDuration(warning.gapMs)} {when} at {formatClock(warning.previousAtMs)}
        {device}.
      </p>
      <p className="mt-2 text-base text-muted">Log {newNoun} anyway?</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="rounded-2xl bg-surface-2 py-4 text-base font-semibold text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-2xl bg-accent py-4 text-base font-semibold text-on-accent"
        >
          Yes, log again
        </button>
      </div>
    </Sheet>
  );
}
