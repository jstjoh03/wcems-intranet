-- ═════════════════════════════════════════════════════════════════════
-- EQUIPMENT CHECK-OUT · trucks, extended assignments, receiver signatures
-- (Justin's first test run, 2026-09-18)
--
-- 1. Trucks: equipment goes on a physical ambulance, so the destination
--    is its truck number (8751, 0081, Vannie Mae, …), not the Medic unit
--    designation that moves between trucks. In-app editable list.
-- 2. Extended assignments: some events run multiple nights over weeks.
--    A check-out can be marked extended with a date span; every crew
--    records a start-of-shift and an end-of-shift check (new custody
--    kinds shift_start / shift_end, same tap-anything-not-found form as
--    the on-shift confirmation).
-- 3. Receiver signatures: a hand-off to a named person (delivery or
--    return) now requires that person's signature, stored as a PNG in
--    the check-out's folder of the private equipment-photos bucket.
-- ═════════════════════════════════════════════════════════════════════

-- ── 1. trucks ────────────────────────────────────────────────────────
create table public.equipment_trucks (
  id uuid primary key default gen_random_uuid(),
  label text not null check (label = btrim(label) and label <> ''),  -- text: 0081 keeps its zeros
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index equipment_trucks_label_uniq on public.equipment_trucks (lower(label));

create trigger equipment_trucks_touch_updated_at
  before update on public.equipment_trucks
  for each row execute function public.touch_updated_at();

alter table public.equipment_trucks enable row level security;
create policy "equipment_trucks select" on public.equipment_trucks
  for select to authenticated using (true);
create policy "equipment_trucks handler write" on public.equipment_trucks
  for all to authenticated
  using (public.is_equipment_handler())
  with check (public.is_equipment_handler());

revoke all on public.equipment_trucks from anon, authenticated;
grant select, insert, update, delete on public.equipment_trucks to authenticated;
grant all on public.equipment_trucks to service_role;

alter publication supabase_realtime add table public.equipment_trucks;

insert into public.equipment_trucks (label, sort) values
  ('8751', 1), ('9238', 2), ('0081', 3), ('8237', 4), ('8744', 5), ('8750', 6),
  ('Vannie Mae', 7), ('2795', 8), ('2793', 9), ('0379', 10), ('8665', 11), ('2794', 12);

-- ── 2. extended assignments ──────────────────────────────────────────
alter table public.equipment_checkouts
  add column extended boolean not null default false,
  add column end_date date,
  add constraint equipment_checkouts_span_check
    check (end_date is null or event_date is null or end_date >= event_date);

grant update (extended, end_date) on public.equipment_checkouts to authenticated;

-- ── 3. receiver signatures + shift-check kinds ───────────────────────
alter table public.equipment_custody_events add column signature_path text;

alter table public.equipment_custody_events
  drop constraint equipment_custody_events_kind_check;
alter table public.equipment_custody_events
  add constraint equipment_custody_events_kind_check check (kind in (
    'checked_out', 'delivered', 'confirmed_present', 'reported_missing',
    'event_closed', 'picked_up', 'returned', 'canceled', 'written_off',
    'shift_start', 'shift_end'
  ));

-- The status view's CASE already maps any other kind to 'on_unit', which
-- is right for shift checks. Recreate it so e.* picks up signature_path
-- (a replace can't insert a column ahead of `status`).
drop view public.equipment_asset_status;
create view public.equipment_asset_status
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

revoke all on public.equipment_asset_status from anon, authenticated;
grant select on public.equipment_asset_status to authenticated;
grant all on public.equipment_asset_status to service_role;

-- ── RPC: check out (adds extended + end date) ────────────────────────
drop function public.equipment_check_out(uuid[], text, text, date, text);

create function public.equipment_check_out(
  p_asset_ids uuid[],
  p_purpose text,
  p_destination text,
  p_event_date date default null,
  p_note text default '',
  p_extended boolean default false,
  p_end_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_app_user_id();
  v_me_name text;
  v_ids uuid[];
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_dest text := btrim(coalesce(p_destination, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_extended boolean := coalesce(p_extended, false);
  v_end date := case when coalesce(p_extended, false) then p_end_date else null end;
  v_checkout uuid;
  v_action uuid := gen_random_uuid();
  v_bad text;
begin
  if v_me is null or not public.is_equipment_handler() then
    raise exception 'Only supervisors, admins, and equipment handlers can check out equipment.'
      using errcode = '42501';
  end if;
  if v_purpose = '' then
    raise exception 'Add what the equipment is for.' using errcode = '22023';
  end if;
  if v_dest = '' then
    raise exception 'Pick the truck it''s going on.' using errcode = '22023';
  end if;
  if v_end is not null and p_event_date is not null and v_end < p_event_date then
    raise exception 'The assignment can''t end before it starts.' using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_asset_ids, '{}'::uuid[])) as x
  where x is not null;
  if v_ids is null then
    raise exception 'Select at least one item.' using errcode = '22023';
  end if;

  -- Serialize against anyone else moving these items right now.
  perform 1 from public.equipment_assets where id = any (v_ids) for update;

  if (select count(*) from public.equipment_assets where id = any (v_ids) and active)
       <> cardinality(v_ids) then
    raise exception 'One or more items are retired or no longer in the registry.'
      using errcode = '22023';
  end if;

  select string_agg(a.tag, ', ' order by a.tag) into v_bad
  from public.equipment_assets a
  cross join lateral (
    select e.kind
    from public.equipment_custody_events e
    where e.asset_id = a.id
    order by e.seq desc
    limit 1
  ) l
  where a.id = any (v_ids)
    and l.kind not in ('returned', 'canceled');
  if v_bad is not null then
    raise exception 'Not on the shelf right now: %. Refresh and pick again.', v_bad
      using errcode = '22023';
  end if;

  select full_name into v_me_name from public.app_users where id = v_me;

  insert into public.equipment_checkouts
    (purpose, destination, event_date, end_date, extended, note, created_by, created_by_name)
  values
    (v_purpose, v_dest, p_event_date, v_end, v_extended, v_note, v_me, coalesce(v_me_name, ''))
  returning id into v_checkout;

  insert into public.equipment_checkout_items (checkout_id, asset_id)
  select v_checkout, x from unnest(v_ids) as x;

  insert into public.equipment_custody_events
    (asset_id, checkout_id, action_id, kind, actor_id, actor_name, recorded_by,
     destination, note)
  select x, v_checkout, v_action, 'checked_out', v_me, coalesce(v_me_name, ''), v_me,
         v_dest, v_note
  from unnest(v_ids) as x;

  return v_checkout;
end;
$$;
revoke all on function public.equipment_check_out(uuid[], text, text, date, text, boolean, date) from public, anon;
grant execute on function public.equipment_check_out(uuid[], text, text, date, text, boolean, date) to authenticated;

-- ── RPC: record a custody step (adds shift checks + signatures) ──────
drop function public.equipment_record(uuid, text, uuid[], text, text, uuid, text, uuid[]);

create function public.equipment_record(
  p_checkout_id uuid,
  p_kind text,
  p_asset_ids uuid[],
  p_note text default '',
  p_photo_path text default null,
  p_handed_to_id uuid default null,
  p_handed_to_name text default null,
  p_missing_ids uuid[] default null,
  p_signature_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_on_unit constant text[] := array[
    'delivered', 'confirmed_present', 'reported_missing', 'event_closed',
    'shift_start', 'shift_end'
  ];
  c_checks constant text[] := array['confirmed_present', 'shift_start', 'shift_end'];
  v_me uuid := public.current_app_user_id();
  v_me_name text;
  v_co public.equipment_checkouts%rowtype;
  v_ids uuid[];
  v_missing uuid[];
  v_all uuid[];
  v_note text := btrim(coalesce(p_note, ''));
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_sig text := nullif(btrim(coalesce(p_signature_path, '')), '');
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
    when 'confirmed_present', 'shift_start', 'shift_end' then
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

  if cardinality(v_missing) > 0 and not (p_kind = any (c_checks)) then
    raise exception 'Only an equipment check can report items missing.'
      using errcode = '22023';
  end if;
  if v_ids && v_missing then
    raise exception 'An item can''t be both here and missing.' using errcode = '22023';
  end if;
  v_all := v_ids || v_missing;
  if cardinality(v_all) = 0 then
    raise exception 'Select at least one item.' using errcode = '22023';
  end if;

  -- Evidence rules. A hand-off needs the receiver's name AND signature;
  -- otherwise a photo of where the items were left.
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
    if v_handed_name is not null and v_sig is null then
      raise exception '% needs to sign to receive the items.', v_handed_name
        using errcode = '22023';
    end if;
  else
    v_sig := null;
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
  if v_sig is not null and (
       split_part(v_sig, '/', 1) <> p_checkout_id::text
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'equipment-photos' and o.name = v_sig
       )
     ) then
    raise exception 'The signature didn''t finish uploading. Try again.'
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
     destination, handed_to_id, handed_to_name, note, photo_path, signature_path)
  select x, p_checkout_id, v_action, p_kind, v_me, coalesce(v_me_name, ''), v_me,
         v_dest, v_handed_id, v_handed_name, v_note, v_photo, v_sig
  from unnest(v_ids) as x;

  insert into public.equipment_custody_events
    (asset_id, checkout_id, action_id, kind, actor_id, actor_name, recorded_by,
     destination, note, photo_path)
  select x, p_checkout_id, v_action, 'reported_missing', v_me, coalesce(v_me_name, ''), v_me,
         v_dest, v_note, v_photo
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
revoke all on function public.equipment_record(uuid, text, uuid[], text, text, uuid, text, uuid[], text) from public, anon;
grant execute on function public.equipment_record(uuid, text, uuid[], text, text, uuid, text, uuid[], text) to authenticated;
