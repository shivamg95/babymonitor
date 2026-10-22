import { useState, type FormEvent, type ReactNode } from 'react';
import { Baby } from 'lucide-react';
import { createProfile, logIn, normalizeBabyId, validateBabyId, validatePassword } from '../services/auth';
import type { Backend } from '../services/backend';
import { BackendError } from '../services/errors';
import type { Session } from '../types';

interface AuthScreenProps {
  backend: Backend;
  notice: string | null;
  onAuthenticated: (session: Session) => void;
}

type Mode = 'login' | 'create';

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-accent';

function messageFor(err: unknown): string {
  if (err instanceof BackendError) {
    switch (err.code) {
      case 'invalid_credentials':
        return 'Baby ID or password is incorrect.';
      case 'baby_id_taken':
        return 'That Baby ID is already taken. Log in instead, or choose another ID.';
      case 'invalid_baby_id':
        return 'Baby ID must be 3 to 32 characters: lowercase letters, numbers and dashes.';
      case 'invalid_baby_name':
        return "Enter the baby's name.";
      case 'weak_password':
        return 'Password must be at least 6 characters.';
      case 'network':
        return "Can't reach the server. Check your connection and try again.";
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function AuthScreen({ backend, notice, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [babyId, setBabyId] = useState('');
  const [babyName, setBabyName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isCreate = mode === 'create';

  function validate(): string | null {
    const idError = validateBabyId(normalizeBabyId(babyId));
    if (idError) return idError;
    if (isCreate) {
      if (!babyName.trim()) return "Enter the baby's name.";
      const pwError = validatePassword(password);
      if (pwError) return pwError;
      if (password !== confirm) return 'Passwords do not match.';
    } else if (!password) {
      return 'Enter the password.';
    }
    return null;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const session = isCreate
        ? await createProfile(backend, { babyId, babyName, password })
        : await logIn(backend, { babyId, password });
      onAuthenticated(session);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (active: boolean) =>
    `rounded-xl py-2.5 text-sm font-semibold ${active ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl bg-accent text-on-accent">
          <Baby className="size-8" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold">Baby Monitor</h1>
        <p className="mt-1 text-sm text-muted">One tap for every diaper, feed and nap.</p>
      </div>

      {notice && <p role="alert" className="mb-4 rounded-2xl bg-surface-2 p-3 text-sm">{notice}</p>}

      {backend.mode === 'local' && (
        <p className="mb-4 rounded-2xl border border-line bg-surface p-3 text-sm text-muted">
          Demo mode. Supabase is not configured, so data stays in this browser. Tabs here sync with each other. Add
          your Supabase keys to sync across phones, tablets and laptops.
        </p>
      )}

      <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
        <button
          type="button"
          role="tab"
          aria-selected={!isCreate}
          className={tabClass(!isCreate)}
          onClick={() => {
            setMode('login');
            setError(null);
          }}
        >
          Log in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isCreate}
          className={tabClass(isCreate)}
          onClick={() => {
            setMode('create');
            setError(null);
          }}
        >
          New baby
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Baby ID"
          hint={isCreate ? 'Lowercase letters, numbers and dashes. Example: leo-2026' : undefined}
        >
          <input
            className={inputClass}
            value={babyId}
            onChange={(e) => setBabyId(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            inputMode="text"
          />
        </Field>

        {isCreate && (
          <Field label="Baby's name">
            <input
              className={inputClass}
              value={babyName}
              onChange={(e) => setBabyName(e.target.value)}
              autoComplete="off"
            />
          </Field>
        )}

        <Field label="Password">
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isCreate ? 'new-password' : 'current-password'}
          />
        </Field>

        {isCreate && (
          <Field label="Confirm password">
            <input
              type="password"
              className={inputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-2xl bg-accent py-4 text-base font-semibold text-on-accent transition-transform active:scale-[0.98]"
        >
          {busy ? 'Please wait...' : isCreate ? 'Create profile' : 'Log in'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted">
        {isCreate
          ? 'Use the same Baby ID and password on every phone, tablet and laptop.'
          : 'Use the Baby ID and password you created for this baby.'}
      </p>
    </div>
  );
}
