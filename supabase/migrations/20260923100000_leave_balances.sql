-- ═════════════════════════════════════════════════════════════════════
-- LEAVE BALANCES · vacation + sick managed in the scheduling module
--
-- HR wants time off run from the schedule instead of double-entry with
-- Paycom. Design (Justin, 2026-09-23): the module is the source of
-- truth; a true-up tool reconciles against Paycom's accrual report.
--
--   sched_leave_ledger   append-only credits: opening import, per-pay-
--                        period accruals, manual adjustments, and
--                        anniversary carry-over write-offs.
--   deductions           are NOT ledger rows — they derive live from
--                        sched_entries (kind timeoff, off_type vacation
--                        or sick), so approvals, cancels, voids and
--                        edits all move balances with no hooks.
--   sched_leave_balances view = ledger sum − used hours (after the
--                        opening as-of date, so Paycom's history isn't
--                        double-counted).
--   sched_leave_catchup() idempotent SECURITY DEFINER: posts missing
--                        accruals for closed pay periods and applies
--                        anniversary write-offs; safe to call from any
--                        signed-in load.
--
-- Rates per the Paycom accrual sheet (field staff, full-time only):
-- vacation 4.31 / 6.47 / 8.62 per period at <3 / 3-6 / ≥6 completed
-- years; sick 2.77 flat. Carry-over cap = 2× the annual accrual,
-- enforced on the anniversary. Pay periods: 14 days anchored
-- 2026-08-30 (Sunday), accrual posts on the period's last day.
-- ═════════════════════════════════════════════════════════════════════

alter table public.app_users add column if not exists hire_date date;

create table public.sched_leave_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  kind text not null check (kind in ('vacation', 'sick')),
  hours numeric(8,2) not null,
  reason text not null check (reason in ('opening', 'accrual', 'adjustment', 'writeoff')),
  effective_on date not null,
  note text,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

-- one accrual / write-off per user+kind+date — makes catchup idempotent
create unique index sched_leave_ledger_once
  on public.sched_leave_ledger (user_id, kind, reason, effective_on)
  where reason in ('accrual', 'writeoff', 'opening');
create index sched_leave_ledger_user on public.sched_leave_ledger (user_id, kind);

alter table public.sched_leave_ledger enable row level security;
create policy "leave read" on public.sched_leave_ledger for select to authenticated
  using (user_id = public.current_app_user_id()
         or public.sched_can_edit()
         or public.sched_level() in ('hr', 'supervisor'));
create policy "leave write" on public.sched_leave_ledger for all to authenticated
  using (public.sched_can_edit() or public.sched_level() = 'hr')
  with check (public.sched_can_edit() or public.sched_level() = 'hr');
grant select, insert, update, delete on public.sched_leave_ledger to authenticated;

-- Paid time-off hours actually on the schedule, after the opening
-- as-of date (Paycom's balances already reflect everything before it).
create or replace function public.sched_leave_opening_asof() returns date
language sql immutable as $$ select date '2026-09-23' $$;

create or replace view public.sched_leave_used
with (security_invoker = true) as
select e.user_id,
       e.off_type as kind,
       round(sum(extract(epoch from (e.end_at - e.start_at)) / 3600.0)::numeric, 2) as used_hours
from public.sched_entries e
where e.kind = 'timeoff'
  and e.off_type in ('vacation', 'sick')
  and e.user_id is not null
  and e.work_date > public.sched_leave_opening_asof()
group by e.user_id, e.off_type;

create or replace view public.sched_leave_balances
with (security_invoker = true) as
select l.user_id, l.kind,
       round(sum(l.hours)::numeric, 2) as credited,
       coalesce(u.used_hours, 0) as used,
       round((sum(l.hours) - coalesce(u.used_hours, 0))::numeric, 2) as balance
from public.sched_leave_ledger l
left join public.sched_leave_used u on u.user_id = l.user_id and u.kind = l.kind
group by l.user_id, l.kind, u.used_hours;

grant select on public.sched_leave_used, public.sched_leave_balances to authenticated;

-- ── accrual + write-off catch-up ─────────────────────────────────────
create or replace function public.sched_vac_rate(p_hire date, p_on date)
returns numeric language sql immutable as $$
  select case
    when p_hire is null then 0
    when p_on < p_hire then 0
    when extract(year from age(p_on, p_hire)) >= 6 then 8.62
    when extract(year from age(p_on, p_hire)) >= 3 then 6.47
    else 4.31 end
$$;

create or replace function public.sched_leave_catchup()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  pe date;
  ann date;
  yrs int;
  cap numeric;
  bal numeric;
  excess numeric;
begin
  for r in
    select id, hire_date from app_users
    where account_type = 'person' and active and employment_type = 'full_time'
      and hire_date is not null
  loop
    -- accruals for every closed pay period after the opening as-of
    pe := date '2026-09-12';           -- last period Paycom already paid
    while pe + 14 <= current_date loop
      pe := pe + 14;
      if pe >= r.hire_date then
        insert into sched_leave_ledger (user_id, kind, hours, reason, effective_on, note)
        values (r.id, 'sick', 2.77, 'accrual', pe, null),
               (r.id, 'vacation', sched_vac_rate(r.hire_date, pe), 'accrual', pe, null)
        on conflict do nothing;
      end if;
    end loop;

    -- anniversary carry-over write-off: cap at 2× the annual accrual
    ann := (r.hire_date + (extract(year from age(current_date, r.hire_date))::int * interval '1 year'))::date;
    if ann > sched_leave_opening_asof() and ann <= current_date and ann > r.hire_date then
      -- vacation cap by the band that begins on this anniversary
      cap := 2 * 26 * sched_vac_rate(r.hire_date, ann);
      select coalesce((select sum(hours) from sched_leave_ledger
                        where user_id = r.id and kind = 'vacation' and effective_on <= ann), 0)
           - coalesce((select sum(extract(epoch from (end_at - start_at)) / 3600.0)
                        from sched_entries
                        where user_id = r.id and kind = 'timeoff' and off_type = 'vacation'
                          and work_date > sched_leave_opening_asof() and work_date <= ann), 0)
        into bal;
      excess := bal - cap;
      if excess > 0 then
        insert into sched_leave_ledger (user_id, kind, hours, reason, effective_on, note)
        values (r.id, 'vacation', -round(excess, 2), 'writeoff', ann,
                'Anniversary carry-over cap (' || cap || ' hrs)')
        on conflict do nothing;
      end if;
      -- sick cap: 2 × 72 = 144
      select coalesce((select sum(hours) from sched_leave_ledger
                        where user_id = r.id and kind = 'sick' and effective_on <= ann), 0)
           - coalesce((select sum(extract(epoch from (end_at - start_at)) / 3600.0)
                        from sched_entries
                        where user_id = r.id and kind = 'timeoff' and off_type = 'sick'
                          and work_date > sched_leave_opening_asof() and work_date <= ann), 0)
        into bal;
      excess := bal - 144;
      if excess > 0 then
        insert into sched_leave_ledger (user_id, kind, hours, reason, effective_on, note)
        values (r.id, 'sick', -round(excess, 2), 'writeoff', ann, 'Anniversary carry-over cap (144 hrs)')
        on conflict do nothing;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.sched_leave_catchup() from public;
grant execute on function public.sched_leave_catchup() to authenticated;
