-- Directed trades vet the TARGET's seat qualification, but RLS rightly
-- hides other members' sched_member_settings rows (they carry sms_phone
-- and notification prefs). This SECURITY DEFINER rpc exposes ONLY the
-- qualification fields, so any scheduling member can run the check —
-- the bug: Kim's p2 override was invisible to Angelica, who kept
-- getting the credential block after the override was saved.
create or replace function sched_qual_info(target uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select case
    when sched_level() = 'none' then jsonb_build_object(
      'qual_overrides', '{}'::jsonb, 'unit_exclusions', '[]'::jsonb)
    else coalesce(
      (select jsonb_build_object(
         'qual_overrides', coalesce(qual_overrides, '{}'::jsonb),
         'unit_exclusions', coalesce(to_jsonb(unit_exclusions), '[]'::jsonb))
       from sched_member_settings where user_id = target),
      jsonb_build_object('qual_overrides', '{}'::jsonb, 'unit_exclusions', '[]'::jsonb))
  end
$$;

revoke all on function sched_qual_info(uuid) from public;
grant execute on function sched_qual_info(uuid) to authenticated;
