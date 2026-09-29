-- Giveaway claims go STRAIGHT to the Chief (Justin, 2026-09-28): the
-- poster already said "anyone take it", so there is nothing for them
-- to accept — the first claim moves the request to partner_accepted
-- and the approval queue. The claimant isn't the requester or the
-- counterparty at claim time, so the existing update policy blocks
-- them; this one admits exactly that transition and nothing else.
create policy "giveaway claim" on public.sched_requests for update to authenticated
  using (
    type = 'giveaway'
    and status = 'pending'
    and counterparty_id is null
    and public.sched_level() not in ('none','view_only')
  )
  with check (
    type = 'giveaway'
    and status = 'partner_accepted'
    and counterparty_id = public.current_app_user_id()
  );
