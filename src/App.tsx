import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Baby, History, type LucideIcon } from 'lucide-react';
import { ActionGrid, type ActionKey } from './components/ActionGrid';
import { AuthScreen } from './components/AuthScreen';
import { BackdateModal } from './components/BackdateModal';
import { DuplicateConfirmModal } from './components/DuplicateConfirmModal';
import { Header } from './components/Header';
import { PostLogToast } from './components/PostLogToast';
import { SummaryHistory } from './components/SummaryHistory';
import { useNightMode } from './hooks/useNightMode';
import { useNow } from './hooks/useNow';
import { clearSession, loadSession, logOut } from './services/auth';
import { getBackend, type Backend } from './services/backend';
import { SyncEngine } from './services/syncEngine';
import type { EventType, Session } from './types';
import { getDuplicateWarning, nextSleepType, type DuplicateWarning } from './utils/cooldown';

type Tab = 'log' | 'history';

interface PendingLog {
  type: EventType;
  atMs: number;
  warning: DuplicateWarning;
}

export default function App() {
  const backend = useMemo(() => getBackend(), []);
  const [session, setSession] = useState<Session | null>(() => loadSession(backend.mode));
  const [notice, setNotice] = useState<string | null>(null);

  const handleSessionExpired = useCallback(() => {
    clearSession();
    setNotice('Your session has expired. Please log in again.');
    setSession(null);
  }, []);

  const handleLogout = useCallback(async () => {
    if (!session) return;
    await logOut(backend, session);
    setSession(null);
  }, [backend, session]);

  if (!session) {
    return (
      <AuthScreen
        backend={backend}
        notice={notice}
        onAuthenticated={(s) => {
          setNotice(null);
          setSession(s);
        }}
      />
    );
  }

  return (
    <Dashboard
      key={session.token}
      backend={backend}
      session={session}
      onSessionExpired={handleSessionExpired}
      onLogout={handleLogout}
    />
  );
}

interface DashboardProps {
  backend: Backend;
  session: Session;
  onSessionExpired: () => void;
  onLogout: () => Promise<void>;
}

function Dashboard({ backend, session, onSessionExpired, onLogout }: DashboardProps) {
  const expiredRef = useRef(onSessionExpired);
  useEffect(() => {
    expiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  const engine = useMemo(
    () => new SyncEngine({ backend, session, onSessionExpired: () => expiredRef.current() }),
    [backend, session],
  );
  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const sync = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const now = useNow(15_000);
  const [night, setNight] = useNightMode();

  const [tab, setTab] = useState<Tab>('log');
  const [pending, setPending] = useState<PendingLog | null>(null);
  const [lastLoggedId, setLastLoggedId] = useState<string | null>(null);
  const [backdateOpen, setBackdateOpen] = useState(false);

  const commitLog = useCallback(
    (type: EventType, atMs: number) => {
      const event = engine.logEvent(type, atMs);
      setLastLoggedId(event.id);
    },
    [engine],
  );

  /**
   * Every log goes through here. A matching entry inside its duplicate window opens the
   * confirm prompt instead of saving. It reads the engine snapshot, not render state,
   * so two quick taps can't both slip past the check.
   */
  const attemptLog = useCallback(
    (type: EventType, atMs: number) => {
      const warning = getDuplicateWarning(type, engine.getSnapshot().events, atMs);
      if (warning) setPending({ type, atMs, warning });
      else commitLog(type, atMs);
    },
    [engine, commitLog],
  );

  const handleTap = (key: ActionKey) => {
    const at = Date.now();
    const type: EventType = key === 'sleep' ? nextSleepType(engine.getSnapshot().events, at) : key;
    attemptLog(type, at);
  };

  // Look the toast entry up in live events, so chip edits show up and Undo hides it.
  const toastEvent = lastLoggedId ? (sync.events.find((e) => e.id === lastLoggedId) ?? null) : null;

  const handleLogoutClick = async () => {
    const unsent = engine.getSnapshot().pendingCount;
    if (
      unsent > 0 &&
      !window.confirm(
        `${unsent} change(s) have not reached the server yet. They stay on this device and upload the next time you log in. Log out anyway?`,
      )
    ) {
      return;
    }
    await onLogout();
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <Header
        babyName={session.babyName}
        babyId={session.babyId}
        sync={sync}
        night={night}
        demoMode={backend.mode === 'local'}
        onToggleNight={() => setNight(!night)}
        onSyncNow={() => void engine.sync()}
        onLogout={() => void handleLogoutClick()}
      />

      <main className="flex-1 px-4 pb-48 pt-4">
        {tab === 'log' ? (
          <>
            <ActionGrid events={sync.events} now={now} onTap={handleTap} />
            <button
              type="button"
              onClick={() => setBackdateOpen(true)}
              className="mt-4 w-full rounded-2xl border border-line bg-surface py-3.5 text-sm font-semibold text-ink"
            >
              Log a past time
            </button>
          </>
        ) : (
          <SummaryHistory events={sync.events} now={now} onDelete={(id) => engine.deleteEvent(id)} />
        )}
      </main>

      <PostLogToast
        event={toastEvent}
        onUndo={() => {
          if (toastEvent) engine.deleteEvent(toastEvent.id);
          setLastLoggedId(null);
        }}
        onChip={(patch) => {
          if (toastEvent) engine.updateDetails(toastEvent.id, patch);
        }}
        onDismiss={() => setLastLoggedId(null)}
      />

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-page/95 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
          <TabButton active={tab === 'log'} onClick={() => setTab('log')} icon={Baby} label="Log" />
          <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={History} label="History" />
        </div>
      </nav>

      {pending && (
        <DuplicateConfirmModal
          warning={pending.warning}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            commitLog(pending.type, pending.atMs);
            setPending(null);
          }}
        />
      )}

      {backdateOpen && (
        <BackdateModal
          events={sync.events}
          onClose={() => setBackdateOpen(false)}
          onAttempt={(type, atMs) => {
            setBackdateOpen(false);
            attemptLog(type, atMs);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 text-xs font-semibold ${
        active ? 'bg-surface text-ink shadow-sm' : 'text-muted'
      }`}
    >
      <Icon className="size-5" aria-hidden="true" />
      {label}
    </button>
  );
}
