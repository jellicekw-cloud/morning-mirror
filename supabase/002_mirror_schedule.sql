-- ============================================================
-- Morning Mirror: usage limit, cache, and the 5-minute scheduler
-- Run in Supabase → SQL Editor AFTER 001_mirror_tables.sql.
--
-- Project URL already filled in (zmtqlcbneupvjifdqrev).
-- Safe to re-run: it replaces the old timer.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Google call counter (the built-in daily cap)
-- ------------------------------------------------------------
create table if not exists public.mirror_api_usage (
  local_date    date primary key,
  google_calls  int  not null default 0
);

-- Returns true and counts the call if under the cap; false if the cap is hit.
create or replace function public.mirror_take_google_call(p_date date, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  insert into public.mirror_api_usage (local_date, google_calls)
  values (p_date, 1)
  on conflict (local_date) do update
    set google_calls = public.mirror_api_usage.google_calls + 1
    where public.mirror_api_usage.google_calls < p_max
  returning google_calls into n;

  return n is not null;
end;
$$;

revoke execute on function public.mirror_take_google_call(date, int) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Cache (weather 15 min, commute 4 min)
-- ------------------------------------------------------------
create table if not exists public.mirror_cache (
  key         text        primary key,
  data        jsonb       not null,
  fetched_at  timestamptz not null default now()
);

alter table public.mirror_api_usage enable row level security;
alter table public.mirror_cache     enable row level security;

-- ------------------------------------------------------------
-- 3. Scheduler: runs every 5 minutes, the function decides
--    (in New York time) whether a nudge is due.
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'mirror-scheduler';

select cron.schedule(
  'mirror-scheduler',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://zmtqlcbneupvjifdqrev.supabase.co/functions/v1/mirror-scheduler',
    headers := '{"Content-Type": "application/json", "x-mirror-key": "dv9VDjX6-J17HkSfhe9wDcbZTczyHZEG"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
