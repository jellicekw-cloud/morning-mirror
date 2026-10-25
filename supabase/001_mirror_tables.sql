-- ============================================================
-- Morning Mirror: database tables (lives in Runway's Supabase)
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Security model: RLS is ON with NO policies, so the browser
-- (anon key / Runway login) can't touch these tables at all.
-- Only the mirror's edge functions (service role) read/write them.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Settings (exactly one row)
-- ------------------------------------------------------------
create table if not exists public.mirror_settings (
  id                    smallint primary key default 1 check (id = 1),
  timezone              text     not null default 'America/New_York',

  -- Daily medication reminder
  meds_time_weekday     time     not null default '05:00',
  meds_time_weekend     time     not null default '09:00',
  meds_nudge_delay_min  int      not null default 10,   -- phone nudge if not logged X min after meds time

  -- Refill tracking (date-based)
  last_refill_date      date,                            -- set this once below
  days_supply           int      not null default 30,
  refill_lead_days      int      not null default 3,     -- warn this many days before run-out
  refill_nudge_time     time     not null default '09:00',

  -- Commute
  work_start_time       time     not null default '06:00',
  arrive_goal_time      time     not null default '05:45',
  leave_ideal_time      time     not null default '05:00',
  leave_latest_time     time     not null default '05:15',
  work_end_time         time     not null default '14:30',

  updated_at            timestamptz not null default now()
);

insert into public.mirror_settings (id) values (1)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 2. Medication log (one row per local day)
-- ------------------------------------------------------------
create table if not exists public.mirror_meds_log (
  id          bigint generated always as identity primary key,
  local_date  date        not null unique,               -- the day in America/New_York
  taken_at    timestamptz not null default now(),
  source      text        not null check (source in ('screen', 'phone'))
);

-- ------------------------------------------------------------
-- 3. Refill log (history; latest row also updates settings)
-- ------------------------------------------------------------
create table if not exists public.mirror_refill_log (
  id           bigint generated always as identity primary key,
  refilled_on  date        not null,
  days_supply  int         not null,
  source       text        not null check (source in ('screen', 'phone', 'manual')),
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. Nudge log (stops duplicate phone alerts)
-- ------------------------------------------------------------
create table if not exists public.mirror_nudge_log (
  local_date  date        not null,
  kind        text        not null check (kind in ('meds', 'refill')),
  sent_at     timestamptz not null default now(),
  primary key (local_date, kind)
);

-- ------------------------------------------------------------
-- 5. Lock everything down (edge functions only)
-- ------------------------------------------------------------
alter table public.mirror_settings   enable row level security;
alter table public.mirror_meds_log   enable row level security;
alter table public.mirror_refill_log enable row level security;
alter table public.mirror_nudge_log  enable row level security;

-- ------------------------------------------------------------
-- 6. Current refill (Oct 15, 2026 → runs out ~Nov 14, heads-up Nov 11)
-- ------------------------------------------------------------
update public.mirror_settings
  set last_refill_date = '2026-10-15', updated_at = now()
where id = 1;

insert into public.mirror_refill_log (refilled_on, days_supply, source)
select '2026-10-15', 30, 'manual'
where not exists (
  select 1 from public.mirror_refill_log where refilled_on = '2026-10-15'
);
