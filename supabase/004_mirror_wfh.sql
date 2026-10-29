-- ============================================================
-- Morning Mirror: Go button log + work-from-home days
-- Run once in Supabase → SQL Editor. Nothing to edit. Safe to re-run.
-- (Includes everything from 003, so you can skip 003.)
-- ============================================================

-- ---------- Go button departure log (same as 003) ----------
create table if not exists public.mirror_departures (
  local_date  date        primary key,
  left_at     timestamptz not null,
  left_min    int         not null,
  status      text        not null check (status in ('on_time', 'close', 'late')),
  source      text        not null default 'screen',
  created_at  timestamptz not null default now()
);
alter table public.mirror_departures enable row level security;

-- ---------- Work-from-home settings ----------
-- wfh_weekdays uses 0 = Sunday … 5 = Friday … 6 = Saturday.
alter table public.mirror_settings add column if not exists wfh_weekdays   smallint[] not null default '{5}';
alter table public.mirror_settings add column if not exists wfh_alarm_time time       not null default '05:45';
alter table public.mirror_settings add column if not exists wfh_logon_time time       not null default '06:00';
alter table public.mirror_settings add column if not exists wfh_meds_time  time       not null default '06:00';

-- ---------- One-off changes ("going in this Friday", "WFH this Tuesday") ----------
create table if not exists public.mirror_day_mode (
  local_date  date        primary key,
  mode        text        not null check (mode in ('office', 'wfh')),
  set_at      timestamptz not null default now()
);
alter table public.mirror_day_mode enable row level security;
