-- ============================================================
-- Morning Mirror: "Go" button departure log
-- Run once in Supabase → SQL Editor. Nothing to edit. Safe to re-run.
-- ============================================================

create table if not exists public.mirror_departures (
  local_date  date        primary key,                 -- the workday (New York time)
  left_at     timestamptz not null,
  left_min    int         not null,                    -- minutes after midnight, New York time (5:04 AM = 304)
  status      text        not null check (status in ('on_time', 'close', 'late')),
  source      text        not null default 'screen',
  created_at  timestamptz not null default now()
);

-- Same lock-down as the other mirror tables: edge functions only.
alter table public.mirror_departures enable row level security;
