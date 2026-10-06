-- Supervisors may amend or remove their OWN truck attestations.
-- Driver (Justin, 2026-10-06): a supervisor attests "roster matched —
-- crew off at 0600", then a late call surfaces and the crew actually
-- got off late. The attesting supervisor needs to fix or withdraw
-- their statement without waiting on a scheduler. Editors keep full
-- update/delete as before; members' shift_confirm / period_signoff
-- rows stay immutable to their owners.

drop policy if exists "verif update" on public.sched_verifications;
create policy "verif update" on public.sched_verifications
  for update
  using (
    sched_can_edit()
    or (
      kind = 'shift_attest'
      and user_id = current_app_user_id()
      and sched_level() = 'supervisor'
    )
  )
  with check (
    sched_can_edit()
    or (
      kind = 'shift_attest'
      and user_id = current_app_user_id()
      and sched_level() = 'supervisor'
    )
  );

drop policy if exists "verif delete" on public.sched_verifications;
create policy "verif delete" on public.sched_verifications
  for delete
  using (
    sched_can_edit()
    or (
      kind = 'shift_attest'
      and user_id = current_app_user_id()
      and sched_level() = 'supervisor'
    )
  );
