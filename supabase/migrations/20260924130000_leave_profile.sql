-- ═════════════════════════════════════════════════════════════════════
-- LEAVE PROFILE (Justin, 2026-09-24): HR needs to set hire dates and
-- manually override accrual rates from the Balances screen — new
-- full-time hires with nothing to import were unreachable, and admin
-- personnel accrue at non-field rates.
--
--   app_users.vac_rate_override / sick_rate_override — null = automatic
--     (the field-staff band from hire_date; sick flat 2.77).
--   sched_set_leave_profile() — SECURITY DEFINER so scheduling editors
--     and HR can maintain hire date + overrides without portal-admin
--     UPDATE rights on app_users.
--   sched_leave_catchup() — accruals + anniversary caps now honor the
--     overrides.
-- ═════════════════════════════════════════════════════════════════════

alter table public.app_users
  add column if not exists vac_rate_override numeric(6,2),
  add column if not exists sick_rate_override numeric(6,2);

create or replace function public.sched_set_leave_profile(
  p_user uuid,
  p_hire date,
  p_vac numeric,
  p_sick numeric
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.sched_can_edit() or public.sched_level() = 'hr') then
    raise exception 'Leave profiles are editor / HR only';
  end if;
  update app_users
     set hire_date = p_hire,
         vac_rate_override = p_vac,
         sick_rate_override = p_sick
   where id = p_user;
end;
$$;

revoke all on function public.sched_set_leave_profile(uuid, date, numeric, numeric) from public;
grant execute on function public.sched_set_leave_profile(uuid, date, numeric, numeric) to authenticated;

create or replace function public.sched_leave_catchup()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  pe date;
  ann date;
  cap numeric;
  bal numeric;
  excess numeric;
  v_rate numeric;
  s_rate numeric;
begin
  for r in
    select id, hire_date, vac_rate_override, sick_rate_override from app_users
    where account_type = 'person' and active and employment_type = 'full_time'
      and hire_date is not null
  loop
    s_rate := coalesce(r.sick_rate_override, 2.77);
    -- accruals for every closed pay period after the opening as-of
    pe := date '2026-09-12';           -- last period Paycom already paid
    while pe + 14 <= current_date loop
      pe := pe + 14;
      if pe >= r.hire_date then
        v_rate := coalesce(r.vac_rate_override, sched_vac_rate(r.hire_date, pe));
        insert into sched_leave_ledger (user_id, kind, hours, reason, effective_on, note)
        values (r.id, 'sick', s_rate, 'accrual', pe, null),
               (r.id, 'vacation', v_rate, 'accrual', pe, null)
        on conflict do nothing;
      end if;
    end loop;

    -- anniversary carry-over write-off: cap at 2× the annual accrual
    ann := (r.hire_date + (extract(year from age(current_date, r.hire_date))::int * interval '1 year'))::date;
    if ann > sched_leave_opening_asof() and ann <= current_date and ann > r.hire_date then
      cap := 2 * 26 * coalesce(r.vac_rate_override, sched_vac_rate(r.hire_date, ann));
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
      -- sick cap: 2 × 72 = 144 (override-rate members keep the same cap)
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
