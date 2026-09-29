-- Time verification chain (Justin, 2026-09-28):
--   1. shift_confirm   — each member confirms their own times when a
--      shift block ends (or reports extra hours / time off instead).
--   2. shift_attest    — ONE ROW PER TRUCK per work date: the on-duty
--      supervisors attest that each unit's roster matched who actually
--      worked (per-truck because S201 may not know about a change on
--      S202's side of the county).
--   3. period_signoff  — every member approves (or disputes) their
--      pay-period hours before HR keys Paycom Monday morning; the
--      crew-facing deadline is 10:00 Sunday.
-- Discrepancies ride the existing sched_requests queue as a new type,
-- so editors resolve them with the tools they already have and close
-- them with "Already handled".

create table public.sched_verifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('shift_confirm','shift_attest','period_signoff')),
  user_id uuid not null references public.app_users(id) on delete cascade,
  work_date date,                                        -- shift_confirm + shift_attest
  unit_id uuid references public.sched_units(id) on delete cascade,  -- shift_attest
  period_end date,                                       -- period_signoff
  status text not null check (status in ('confirmed','flagged','approved','disputed')),
  note text,
  -- what was verified, frozen at the moment of verification — the
  -- payroll board compares this against the live schedule to flag
  -- "changed after sign-off"
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- one confirm per member per work date
create unique index sched_verif_confirm_uniq on public.sched_verifications (user_id, work_date)
  where kind = 'shift_confirm';
-- one attestation per truck per work date (first supervisor there wins)
create unique index sched_verif_attest_uniq on public.sched_verifications (work_date, unit_id)
  where kind = 'shift_attest';
-- one sign-off per member per period
create unique index sched_verif_signoff_uniq on public.sched_verifications (user_id, period_end)
  where kind = 'period_signoff';
create index sched_verif_date_idx on public.sched_verifications (kind, work_date);
create index sched_verif_period_idx on public.sched_verifications (kind, period_end);

alter table public.sched_verifications enable row level security;

-- own rows always; attest rows + board reads for supervisors, HR, editors
create policy "verif read" on public.sched_verifications for select to authenticated
  using (
    user_id = public.current_app_user_id()
    or public.sched_can_edit()
    or public.sched_level() in ('supervisor','hr')
  );

-- crew write their own confirms/sign-offs; attest needs supervisor+;
-- editors may write anything (fix-ups)
create policy "verif insert" on public.sched_verifications for insert to authenticated
  with check (
    public.sched_can_edit()
    or (kind in ('shift_confirm','period_signoff')
        and user_id = public.current_app_user_id()
        and public.sched_level() not in ('none','view_only'))
    or (kind = 'shift_attest'
        and user_id = public.current_app_user_id()
        and public.sched_level() = 'supervisor')
  );

-- undo a mistaken attest / clear a bad row: editors only
create policy "verif update" on public.sched_verifications for update to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());
create policy "verif delete" on public.sched_verifications for delete to authenticated
  using (public.sched_can_edit());

grant all on public.sched_verifications to authenticated;
grant all on public.sched_verifications to service_role;

-- discrepancy requests: "so-and-so left sick at 1400 and X covered" —
-- filed from the verify card, the attest drawer, or a period dispute
alter table public.sched_requests drop constraint sched_requests_type_check;
alter table public.sched_requests add constraint sched_requests_type_check
  check (type in ('pickup','trade','giveaway','time_off','extra_hours','discrepancy'));

-- exactly-once claims for the cron-driven verification sends, same
-- pattern as sched_reminders_sent (unique row = the send happened)
create table public.sched_notify_claims (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  ref text not null,
  sent_at timestamptz not null default now(),
  unique (kind, user_id, ref)
);
alter table public.sched_notify_claims enable row level security;
create policy "nclaims read editors" on public.sched_notify_claims for select to authenticated
  using (public.sched_can_edit());
grant select on public.sched_notify_claims to authenticated;
grant all on public.sched_notify_claims to service_role;
