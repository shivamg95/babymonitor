import { LogOut, Moon, RefreshCw, Sun } from 'lucide-react';
import type { SyncSnapshot } from '../services/syncEngine';
import { formatClock } from '../utils/time';

interface HeaderProps {
  babyName: string;
  babyId: string;
  sync: SyncSnapshot;
  night: boolean;
  demoMode: boolean;
  onToggleNight: () => void;
  onSyncNow: () => void;
  onLogout: () => void;
}

function describeSync(sync: SyncSnapshot): { text: string; dot: string } {
  switch (sync.status) {
    case 'synced':
      return { text: 'Synced', dot: 'bg-emerald-500' };
    case 'syncing':
      return { text: 'Syncing...', dot: 'bg-sky-400' };
    case 'offline':
      return {
        text: sync.pendingCount > 0 ? `Offline · ${sync.pendingCount} queued` : 'Offline',
        dot: 'bg-amber-500',
      };
    case 'error':
      return { text: 'Sync error · tap to retry', dot: 'bg-red-500' };
  }
}

export function Header({ babyName, babyId, sync, night, demoMode, onToggleNight, onSyncNow, onLogout }: HeaderProps) {
  const status = describeSync(sync);
  const syncing = sync.status === 'syncing';

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/95 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-bold leading-tight">{babyName}</div>
          <div className="truncate text-xs text-muted">
            ID <span className="font-mono">{babyId}</span>
            {demoMode && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5">demo</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onSyncNow}
            title={sync.lastSyncedAt ? `Last synced ${formatClock(sync.lastSyncedAt)}` : 'Not synced yet'}
            className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-xs font-semibold text-ink"
          >
            {syncing ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <span className={`size-2 rounded-full ${status.dot}`} aria-hidden="true" />
            )}
            <span>{status.text}</span>
          </button>

          <button
            type="button"
            onClick={onToggleNight}
            aria-label={night ? 'Turn off night mode' : 'Turn on night mode'}
            aria-pressed={night}
            className="rounded-full bg-surface p-2 text-ink"
          >
            {night ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>

          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            className="rounded-full bg-surface p-2 text-ink"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
