-- The audit table shipped write-locked ("service/definer paths only").
-- The module now records actions straight from the client, so any
-- module user may insert rows attributed to THEMSELVES; reading stays
-- editor-only (existing policy "audit read admins").
create policy "audit insert own" on public.sched_audit for insert to authenticated
  with check (
    actor_id = public.current_app_user_id()
    and public.sched_level() <> 'none'
  );

grant insert on public.sched_audit to authenticated;
grant usage, select on sequence public.sched_audit_id_seq to authenticated;
