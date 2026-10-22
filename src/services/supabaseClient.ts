import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the env vars are missing. The app then runs in local demo mode. */
export const isSupabaseConfigured = Boolean(url && anonKey);

// The app has no Supabase Auth. Baby ID + password is handled by bm_* RPC functions,
// so session persistence and token refresh are turned off.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;
