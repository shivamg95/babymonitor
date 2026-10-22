export type BackendErrorCode =
  | 'invalid_credentials'
  | 'baby_id_taken'
  | 'invalid_baby_id'
  | 'invalid_baby_name'
  | 'weak_password'
  | 'invalid_session'
  | 'network'
  | 'unknown';

const KNOWN_CODES: readonly BackendErrorCode[] = [
  'invalid_credentials',
  'baby_id_taken',
  'invalid_baby_id',
  'invalid_baby_name',
  'weak_password',
  'invalid_session',
];

export class BackendError extends Error {
  readonly code: BackendErrorCode;

  constructor(code: BackendErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'BackendError';
    this.code = code;
  }
}

/** Maps a raw server/RPC error message onto a stable code. Unknown messages are treated as network errors. */
export function backendErrorFromMessage(message: string): BackendError {
  const code = KNOWN_CODES.find((c) => message.includes(c));
  return code ? new BackendError(code, message) : new BackendError('network', message);
}

export const BABY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 6;
