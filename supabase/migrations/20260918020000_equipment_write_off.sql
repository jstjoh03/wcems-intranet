-- ═════════════════════════════════════════════════════════════════════
-- EQUIPMENT CHECK-OUT · write-off for gear that's truly lost
--
-- A radio the crew reported not found could only leave the board by
-- faking a pickup + return. Add an explicit, handler-only custody step:
--
--   reported_missing ─► written_off   (note required: what happened,
--                                      who was notified)
--   written_off ─► returned           (it turned up — dropped at Admin)
--
-- A written-off item counts as resolved, so its check-out can close;
-- its status reads 'lost' and it can't be checked out again until it's
-- returned.
-- ═════════════════════════════════════════════════════════════════════

alter table public.equipment_custody_events
  drop constraint equipment_custody_events_kind_check;
alter table public.equipment_custody_events
  add constraint equipment_custody_events_kind_check check (kind in (
    'checked_out', 'delivered', 'confirmed_present', 'reported_missing',
    'event_closed', 'picked_up', 'returned', 'canceled', 'written_off'
  ));

create or replace view public.equipment_asset_status
with (security_invoker = true)
as
select distinct on (e.asset_id)
  e.*,
  case e.kind
    when 'checked_out' then 'in_transit'
    when 'picked_up' then 'returning'
    when 'reported_missing' then 'missing'
    when 'written_off' then 'lost'
    when 'returned' then 'available'
    when 'canceled' then 'available'
    else 'on_unit'
  end as status
from public.equipment_custody_events e
order by e.asset_id, e.seq desc;

create or replace function public.equipment_record(
  p_checkout_id uuid,
  p_kind text,
  p_asset_ids uuid[],
  p_note text default '',
  p_photo_path text default null,
  p_handed_to_id uuid default null,
  p_handed_to_name text default null,
  p_missing_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_on_unit constant text[] :=
    array['delivered', 'confirmed_present', 'reported_missing', 'event_closed'];
  v_me uuid := public.current_app_user_id();
  v_me_name text;
  v_co public.equipment_checkouts%rowtype;
  v_ids uuid[];
  v_missing uuid[];
  v_all uuid[];
  v_note text := btrim(coalesce(p_note, ''));
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_handed_id uuid;
  v_handed_name text;
  v_from text[];
  v_needs_handler boolean;
  v_dest text;
  v_action uuid := gen_random_uuid();
  v_bad text;
begin
  if v_me is null
     or public.is_kiosk_user()
     or not exists (select 1 from public.app_users where id = v_me and active) then
    raise exception 'Sign in with your own account to record equipment custody.'
      using errcode = '42501';
  end if;

  select * into v_co from public.equipment_checkouts where id = p_checkout_id;
  if not found then
    raise exception 'Check-out not found.' using errcode = '22023';
  end if;

  case p_kind
    when 'delivered' then
      v_from := array['checked_out']; v_needs_handler := true; v_dest := v_co.destination;
    when 'canceled' then
      v_from := array['checked_out']; v_needs_handler := true; v_dest := 'Admin';
    when 'confirmed_present' then
      v_from := c_on_unit; v_needs_handler := false; v_dest := v_co.destination;
    when 'event_closed' then
      v_from := c_on_unit; v_needs_handler := false; v_dest := v_co.destination;
    when 'picked_up' then
      v_from := c_on_unit; v_needs_handler := true; v_dest := 'Admin';
    when 'returned' then
      v_from := array['picked_up', 'written_off']; v_needs_handler := true; v_dest := 'Admin';
    when 'written_off' then
      v_from := array['reported_missing']; v_needs_handler := true; v_dest := v_co.destination;
    else
      raise exception 'Unknown custody step: %', p_kind using errcode = '22023';
  end case;

  if v_needs_handler and not public.is_equipment_handler() then
    raise exception 'Only supervisors, admins, and equipment handlers can do that step.'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
  from unnest(coalesce(p_asset_ids, '{}'::uuid[])) as x
  where x is not null;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_missing
  from unnest(coalesce(p_missing_ids, '{}'::uuid[])) as x
  where x is not null;

  if cardinality(v_missing) > 0 and p_kind <> 'confirmed_present' then
    raise exception 'Only the on-shift confirmation can report items missing.'
      using errcode = '22023';
  end if;
  if v_ids && v_missing then
    raise exception 'An item can''t be both here and missing.' using errcode = '22023';
  end if;
  v_all := v_ids || v_missing;
  if cardinality(v_all) = 0 then
    raise exception 'Select at least one item.' using errcode = '22023';
  end if;

  -- Evidence rules.
  if p_kind in ('delivered', 'returned') then
    if p_handed_to_id is not null then
      select full_name into v_handed_name from public.app_users where id = p_handed_to_id;
      if v_handed_name is null then
        raise exception 'That person isn''t on the roster.' using errcode = '22023';
      end if;
      v_handed_id := p_handed_to_id;
    else
      v_handed_name := nullif(btrim(coalesce(p_handed_to_name, '')), '');
    end if;
    if v_handed_name is null and v_photo is null then
      raise exception 'Name who you handed the items to, or add a photo of where you left them.'
        using errcode = '22023';
    end if;
  end if;
  if p_kind = 'event_closed' and v_photo is null then
    raise exception 'A photo of where the items were left is required.' using errcode = '22023';
  end if;
  if cardinality(v_missing) > 0 and v_note = '' then
    raise exception 'Add a note about what''s missing.' using errcode = '22023';
  end if;
  if p_kind = 'written_off' and v_note = '' then
    raise exception 'Add a note: what happened, and who was notified.' using errcode = '22023';
  end if;
  if v_photo is not null and (
       split_part(v_photo, '/', 1) <> p_checkout_id::text
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'equipment-photos' and o.name = v_photo
       )
     ) then
    raise exception 'The photo didn''t finish uploading. Attach it again.'
      using errcode = '22023';
  end if;

  -- Serialize against anyone else moving these items right now.
  perform 1 from public.equipment_assets where id = any (v_all) for update;

  if exists (
    select 1 from unnest(v_all) as x
    where not exists (
      select 1 from public.equipment_checkout_items ci
      where ci.checkout_id = p_checkout_id and ci.asset_id = x
    )
  ) then
    raise exception 'One or more items aren''t on this check-out.' using errcode = '22023';
  end if;

  select string_agg(a.tag, ', ' order by a.tag) into v_bad
  from unnest(v_all) as x
  join public.equipment_assets a on a.id = x
  left join lateral (
    select e.kind
    from public.equipment_custody_events e
    where e.asset_id = x and e.checkout_id = p_checkout_id
    order by e.seq desc
    limit 1
  ) l on true
  where l.kind is null or not (l.kind = any (v_from));
  if v_bad is not null then
    raise exception 'Some items have already moved on (%). Refresh and try again.', v_bad
      using errcode = '22023';
  end if;

  select full_name into v_me_name from public.app_users where id = v_me;

  insert into public.equipment_custody_events
    (asset_id, checkout_id, action_id, kind, actor_id, actor_name, recorded_by,
     destination, handed_to_id, handed_to_name, note, photo_path)
  select x, p_checkout_id, v_action, p_kind, v_me, coalesce(v_me_name, ''), v_me,
         v_dest, v_handed_id, v_handed_name, v_note, v_photo
  from unnest(v_ids) as x;

  insert into public.equipment_custody_events
    (asset_id, checkout_id, action_id, kind, actor_id, actor_name, recorded_by,
     destination, note)
  select x, p_checkout_id, v_action, 'reported_missing', v_me, coalesce(v_me_name, ''), v_me,
         v_dest, v_note
  from unnest(v_missing) as x;

  -- Close the check-out once every item is resolved (back, canceled, or
  -- written off).
  update public.equipment_checkouts c
     set closed_at = now()
   where c.id = p_checkout_id
     and c.closed_at is null
     and not exists (
       select 1
       from public.equipment_checkout_items ci
       cross join lateral (
         select e.kind
         from public.equipment_custody_events e
         where e.asset_id = ci.asset_id and e.checkout_id = ci.checkout_id
         order by e.seq desc
         limit 1
       ) l
       where ci.checkout_id = c.id
         and l.kind not in ('returned', 'canceled', 'written_off')
     );

  return v_action;
end;
$$;
revoke all on function public.equipment_record(uuid, text, uuid[], text, text, uuid, text, uuid[]) from public, anon;
grant execute on function public.equipment_record(uuid, text, uuid[], text, text, uuid, text, uuid[]) to authenticated;
