import type { Backend } from './backend';
import { BABY_ID_PATTERN, MIN_PASSWORD_LENGTH } from './errors';
import type { BackendMode, Session } from '../types';
import { detectDeviceLabel } from '../utils/device';

const SESSION_KEY = 'bm:session';

export function normalizeBabyId(input: string): string {
  return input.trim().toLowerCase();
}

/** Returns a user-facing message, or null when the Baby ID is valid. */
export function validateBabyId(babyId: string): string | null {
  return BABY_ID_PATTERN.test(babyId)
    ? null
    : 'Baby ID must be 3 to 32 characters: lowercase letters, numbers and dashes (e.g. leo-2026).';
}

export function validatePassword(password: string): string | null {
  return password.length >= MIN_PASSWORD_LENGTH
    ? null
    : `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
}

/** A session is only reused if it was created by the same backend mode. */
export function loadSession(mode: BackendMode): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return session.mode === mode && session.token ? session : null;
  } catch {
    return null;
  }
}

function persistSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export async function createProfile(
  backend: Backend,
  input: { babyId: string; babyName: string; password: string },
): Promise<Session> {
  const session = await backend.createBaby({
    babyId: normalizeBabyId(input.babyId),
    babyName: input.babyName.trim(),
    password: input.password,
    deviceLabel: detectDeviceLabel(),
  });
  persistSession(session);
  return session;
}

export async function logIn(backend: Backend, input: { babyId: string; password: string }): Promise<Session> {
  const session = await backend.login({
    babyId: normalizeBabyId(input.babyId),
    password: input.password,
    deviceLabel: detectDeviceLabel(),
  });
  persistSession(session);
  return session;
}

export async function logOut(backend: Backend, session: Session): Promise<void> {
  clearSession();
  await backend.logout(session);
}
