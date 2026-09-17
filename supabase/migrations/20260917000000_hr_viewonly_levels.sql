-- New scheduling access levels:
--   hr        — payroll: Time Reports with export + the Paycom earning-code
--               setup, but no rotation/day editing (that stays global admin
--               / scheduler via sched_can_edit()).
--   view_only — can open the module and look at every board, but cannot
--               file requests, trade offers, claims, or availability.
-- Reads already flow from sched_level() <> 'none'; sched_level() returns
-- the stored value untouched, so only the check constraint, one scoped
-- settings policy, and the self-service inserts change.

alter table sched_access drop constraint sched_access_level_check;
alter table sched_access add constraint sched_access_level_check
  check (level in ('global_admin', 'scheduler', 'hr', 'view_only', 'none'));

-- HR may write ONLY the paycom earning-codes settings row.
create policy "settings write hr paycom" on sched_settings
  for all
  using (sched_level() = 'hr' and key = 'paycom')
  with check (sched_level() = 'hr' and key = 'paycom');

-- View-only cannot self-serve: requests, trade offers, page claims,
-- and availability inserts all require a participating level.
drop policy "requests insert own" on sched_requests;
create policy "requests insert own" on sched_requests
  for insert
  with check (
    sched_can_edit()
    or (requester_id = current_app_user_id() and sched_level() not in ('none', 'view_only'))
  );

drop policy "offers insert own" on sched_trade_offers;
create policy "offers insert own" on sched_trade_offers
  for insert
  with check (
    sched_can_edit()
    or (user_id = current_app_user_id() and sched_level() not in ('none', 'view_only'))
  );

drop policy "claims insert own" on sched_page_claims;
create policy "claims insert own" on sched_page_claims
  for insert
  with check (
    sched_can_edit()
    or (user_id = current_app_user_id() and sched_level() not in ('none', 'view_only'))
  );

drop policy "avail write own" on sched_availability;
create policy "avail write own" on sched_availability
  for all
  using (
    sched_can_edit()
    or (user_id = current_app_user_id() and sched_level() not in ('none', 'view_only'))
  )
  with check (
    sched_can_edit()
    or (user_id = current_app_user_id() and sched_level() not in ('none', 'view_only'))
  );
