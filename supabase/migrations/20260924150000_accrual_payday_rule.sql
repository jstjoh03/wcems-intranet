-- ═════════════════════════════════════════════════════════════════════
-- PAYDAY RULE (Justin, 2026-09-24): Paycom awards an accrual on every
-- PAYDAY on/after the hire date, and paydays land 6 days after the
-- period closes (Aug 2–15 paid Aug 21). The 8/17 new-hire class was
-- awarded the 8/21 payday's accrual without receiving a check — so a
-- hire at the start of a period banks the period that closed just
-- before them. sched_leave_catchup() previously credited only periods
-- ENDING on/after the hire date; now it credits periods whose payday
-- (pe + 6) is on/after it, matching openingAccrual() in the app.
-- ═════════════════════════════════════════════════════════════════════

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
    -- accruals for every closed pay period after the opening as-of;
    -- a period counts once its payday (close + 6) is on/after hire
    pe := date '2026-09-12';           -- last period Paycom already paid
    while pe + 14 <= current_date loop
      pe := pe + 14;
      if pe + 6 >= r.hire_date then
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
