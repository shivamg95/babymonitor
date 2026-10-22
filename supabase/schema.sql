-- =============================================================
-- Baby Monitor - Supabase schema
-- Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query
--
-- Design:
--   * Tables have RLS enabled with NO policies, and anon/authenticated have no
--     table grants. The public anon key therefore cannot read or write data
--     directly.
--   * All access goes through the bm_* functions (security definer). They
--     verify a Baby ID + password (bcrypt via pgcrypto) once at login and then
--     hand the app an opaque session token.
--   * Multi-device sync: each event has a server-side updated_at cursor. Devices
--     pull "everything changed since my cursor" and push their pending events.
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.babies (
  baby_id       text primary key,
  baby_name     text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  constraint babies_baby_id_format check (baby_id ~ '^[a-z0-9][a-z0-9-]{2,31}$')
);

create table if not exists public.baby_sessions (
  token        text primary key,
  baby_id      text not null references public.babies (baby_id) on delete cascade,
  device_label text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.baby_events (
  id           uuid primary key,                       -- generated on the device, so offline writes are idempotent
  baby_id      text not null references public.babies (baby_id) on delete cascade,
  type         text not null check (type in ('milk', 'urine', 'potty', 'both', 'sleep_start', 'sleep_end', 'medicine')),
  occurred_at  timestamptz not null default now(),     -- when it happened (can be backdated)
  details      jsonb not null default '{}'::jsonb,     -- optional chips: { "label": "90 ml", "amountMl": 90 }
  device_label text,                                   -- Phone / Tablet / Laptop
  deleted      boolean not null default false,         -- tombstone so deletes propagate to other devices
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default clock_timestamp() -- set by trigger below, server clock
);

create index if not exists baby_events_sync_idx on public.baby_events (baby_id, updated_at);
create index if not exists baby_events_time_idx on public.baby_events (baby_id, occurred_at);
create index if not exists baby_sessions_baby_idx on public.baby_sessions (baby_id);

-- Server-side clock for sync cursors (avoids phone clock skew breaking sync).
create or replace function public.bm_touch_event()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists bm_touch_event on public.baby_events;
create trigger bm_touch_event
  before insert or update on public.baby_events
  for each row execute function public.bm_touch_event();

-- Lock the tables down. Only the bm_* functions can touch them.
alter table public.babies        enable row level security;
alter table public.baby_sessions enable row level security;
alter table public.baby_events   enable row level security;

revoke all on public.babies, public.baby_sessions, public.baby_events from anon, authenticated;

-- ---------- Internal helper ----------

create or replace function public.bm_require_session(p_token text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_baby_id text;
begin
  update public.baby_sessions
     set last_seen_at = now()
   where token = p_token
  returning baby_id into v_baby_id;

  if v_baby_id is null then
    raise exception 'invalid_session';
  end if;

  return v_baby_id;
end $$;

-- ---------- Auth ----------

-- Creates a new baby profile and returns a session: { token, babyId, babyName }
create or replace function public.bm_create_baby(
  p_baby_id text,
  p_baby_name text,
  p_password text,
  p_device_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    text := lower(trim(p_baby_id));
  v_name  text := trim(coalesce(p_baby_name, ''));
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  if v_id !~ '^[a-z0-9][a-z0-9-]{2,31}$' then
    raise exception 'invalid_baby_id';
  end if;
  if length(v_name) = 0 then
    raise exception 'invalid_baby_name';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'weak_password';
  end if;

  begin
    insert into public.babies (baby_id, baby_name, password_hash)
    values (v_id, v_name, crypt(p_password, gen_salt('bf')));
  exception when unique_violation then
    raise exception 'baby_id_taken';
  end;

  insert into public.baby_sessions (token, baby_id, device_label)
  values (v_token, v_id, p_device_label);

  return jsonb_build_object('token', v_token, 'babyId', v_id, 'babyName', v_name);
end $$;

-- Logs in with Baby ID + password and returns a session: { token, babyId, babyName }
create or replace function public.bm_login(
  p_baby_id text,
  p_password text,
  p_device_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    text := lower(trim(coalesce(p_baby_id, '')));
  v_baby  public.babies%rowtype;
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  select * into v_baby from public.babies b where b.baby_id = v_id;

  if not found or crypt(coalesce(p_password, ''), v_baby.password_hash) <> v_baby.password_hash then
    raise exception 'invalid_credentials';
  end if;

  insert into public.baby_sessions (token, baby_id, device_label)
  values (v_token, v_baby.baby_id, p_device_label);

  return jsonb_build_object('token', v_token, 'babyId', v_baby.baby_id, 'babyName', v_baby.baby_name);
end $$;

create or replace function public.bm_logout(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.baby_sessions where token = p_token;
$$;

-- ---------- Events ----------

-- Returns up to p_limit events for this baby changed after p_since (null = from the start),
-- oldest change first, so the client can page through a long history.
-- Includes tombstones (deleted = true) so other devices can remove them.
create or replace function public.bm_list_events(
  p_token text,
  p_since timestamptz default null,
  p_limit integer default 1000
)
returns setof public.baby_events
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_baby_id text;
begin
  v_baby_id := public.bm_require_session(p_token);

  return query
    select e.*
      from public.baby_events e
     where e.baby_id = v_baby_id
       and (p_since is null or e.updated_at > p_since)
     order by e.updated_at
     limit least(greatest(p_limit, 1), 1000);
end $$;

-- Inserts or updates a batch of events. Input is a JSON array of:
--   { id, type, occurred_at, details, device_label, deleted }
-- An event id that belongs to another baby is silently ignored.
create or replace function public.bm_upsert_events(
  p_token text,
  p_events jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_baby_id text;
  v_count   integer;
begin
  v_baby_id := public.bm_require_session(p_token);

  insert into public.baby_events as be
    (id, baby_id, type, occurred_at, details, device_label, deleted)
  select (ev->>'id')::uuid,
         v_baby_id,
         ev->>'type',
         (ev->>'occurred_at')::timestamptz,
         coalesce(ev->'details', '{}'::jsonb),
         ev->>'device_label',
         coalesce((ev->>'deleted')::boolean, false)
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as ev
  on conflict (id) do update
     set type         = excluded.type,
         occurred_at  = excluded.occurred_at,
         details      = excluded.details,
         device_label = excluded.device_label,
         deleted      = excluded.deleted
   where be.baby_id = excluded.baby_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------- Grants ----------
-- Functions are callable by the anon key (the app logs in with Baby ID + password).

revoke all on function public.bm_require_session(text) from public, anon, authenticated;

revoke all on function public.bm_create_baby(text, text, text, text) from public;
revoke all on function public.bm_login(text, text, text) from public;
revoke all on function public.bm_logout(text) from public;
revoke all on function public.bm_list_events(text, timestamptz, integer) from public;
revoke all on function public.bm_upsert_events(text, jsonb) from public;

grant execute on function public.bm_create_baby(text, text, text, text) to anon, authenticated;
grant execute on function public.bm_login(text, text, text) to anon, authenticated;
grant execute on function public.bm_logout(text) to anon, authenticated;
grant execute on function public.bm_list_events(text, timestamptz, integer) to anon, authenticated;
grant execute on function public.bm_upsert_events(text, jsonb) to anon, authenticated;
