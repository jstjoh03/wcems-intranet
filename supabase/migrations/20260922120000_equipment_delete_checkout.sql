-- ═════════════════════════════════════════════════════════════════════
-- EQUIPMENT CHECK-OUT · admin delete for test runs and mistakes
--
-- The custody tables are append-only by design — no DELETE policies —
-- so a practice check-out (Rhonda's Fair walkthrough, 2026-09-21) could
-- only be purged by hand in SQL. Admins get an explicit escape hatch:
-- one RPC that erases a check-out's custody events, item list, and the
-- row itself. Photos live in storage and can't be deleted from SQL
-- (protect_objects_delete); the client removes the folder through the
-- storage API first, under the existing "equipment-photos admin
-- delete" policy.
-- ═════════════════════════════════════════════════════════════════════

create or replace function public.equipment_delete_checkout(p_checkout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete a check-out.';
  end if;
  delete from public.equipment_custody_events where checkout_id = p_checkout_id;
  delete from public.equipment_checkout_items where checkout_id = p_checkout_id;
  delete from public.equipment_checkouts where id = p_checkout_id;
end;
$$;

revoke all on function public.equipment_delete_checkout(uuid) from public;
grant execute on function public.equipment_delete_checkout(uuid) to authenticated;
