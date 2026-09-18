-- ═════════════════════════════════════════════════════════════════════
-- EQUIPMENT CHECK-OUT · event equipment chain of custody
--
-- Library-style custody tracker for the event gear kept at Admin
-- (radios, iPads, …). PSTrax stays the system of record for the assets
-- themselves; this module only records WHERE each item is and WHO moved
-- it. One check-out = a batch of items going to one unit for one event:
--
--   checked_out ─► delivered ─► confirmed_present | reported_missing
--        │                  ─► event_closed ─► picked_up ─► returned
--        └─► canceled  (only before delivery)
--
-- Principles:
--   · equipment_custody_events is the append-only source of truth. An
--     asset's status is DERIVED from its latest event, never stored twice
--     (equipment_asset_status view). equipment_checkouts.closed_at is
--     only a convenience flag the RPC sets in the same transaction once
--     every item is back.
--   · Every transition goes through a SECURITY DEFINER RPC that locks the
--     assets and validates the move, so two phones can't check out the
--     same radio or skip a step. Clients never write the log, the
--     check-outs, or the items directly.
--   · Photo evidence (where items were left) lives in the private
--     equipment-photos bucket under <checkout_id>/…; the RPC confirms the
--     object exists before accepting a path.
--   · actor_id vs recorded_by: identical today. The planned shared iPad
--     kiosk at Admin will record on a person's behalf (recorded_by = the
--     kiosk account, actor_id = the person picked on screen).
--   · Access: everyone signed in views the board and can do the event-day
--     confirmation + event-end photo. Check-out, delivery, pickup, return,
--     and the registry belong to equipment handlers = supervisors + admins
--     + a person-grant list for admin staff who aren't app admins. Kiosk
--     accounts stay read-only.
-- ═════════════════════════════════════════════════════════════════════

-- ── types (in-app editable) ──────────────────────────────────────────
create table public.equipment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index equipment_types_name_uniq
  on public.equipment_types (lower(btrim(name)));

-- ── assets (registry; the PSTrax tag is TEXT — leading zeros matter) ─
create table public.equipment_assets (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique check (tag = btrim(tag) and tag <> ''),
  name text not null check (btrim(name) <> ''),
  type_id uuid references public.equipment_types(id) on delete set null,
  notes text not null default '',
  active boolean not null default true,
  created_by uuid default public.current_app_user_id()
    references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equipment_assets_type_idx on public.equipment_assets (type_id);

-- ── handler grants (admin staff who aren't supervisors/admins) ───────
create table public.equipment_handlers (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_equipment_handler()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not public.is_kiosk_user() and (
    public.is_supervisor()
    or exists (
      select 1
      from public.equipment_handlers h
      join public.app_users u on u.id = h.user_id
      where u.auth_user_id = auth.uid()
        and u.active
    )
  );
$$;
revoke all on function public.is_equipment_handler() from public, anon;
grant execute on function public.is_equipment_handler() to authenticated;

-- ── check-outs + their items ─────────────────────────────────────────
create table public.equipment_checkouts (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (btrim(purpose) <> ''),       -- the event
  destination text not null check (btrim(destination) <> ''), -- the unit
  event_date date,
  note text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index equipment_checkouts_open_idx
  on public.equipment_checkouts (created_at desc) where closed_at is null;

create table public.equipment_checkout_items (
  checkout_id uuid not null references public.equipment_checkouts(id) on delete restrict,
  asset_id uuid not null references public.equipment_assets(id) on delete restrict,
  primary key (checkout_id, asset_id)
);
create index equipment_checkout_items_asset_idx
  on public.equipment_checkout_items (asset_id);

-- ── custody log (append-only) ────────────────────────────────────────
create table public.equipment_custody_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  asset_id uuid not null references public.equipment_assets(id) on delete restrict,
  checkout_id uuid not null references public.equipment_checkouts(id) on delete restrict,
  -- groups the per-item rows one action wrote (one timeline entry)
  action_id uuid not null,
  kind text not null check (kind in (
    'checked_out', 'delivered', 'confirmed_present', 'reported_missing',
    'event_closed', 'picked_up', 'returned', 'canceled'
  )),
  actor_id uuid references public.app_users(id) on delete set null,
  actor_name text not null default '',        -- snapshot for the record
  recorded_by uuid references public.app_users(id) on delete set null,
  destination text not null default '',       -- where the item is/was headed
  handed_to_id uuid references public.app_users(id) on delete set null,
  handed_to_name text,                        -- snapshot, or a non-roster name
  note text not null default '',
  photo_path text,
  at timestamptz not null default now()
);
create unique index equipment_custody_events_seq_uniq
  on public.equipment_custody_events (seq);
create index equipment_custody_events_asset_idx
  on public.equipment_custody_events (asset_id, seq desc);
create index equipment_custody_events_checkout_idx
  on public.equipment_custody_events (checkout_id, seq);

-- ── derived status: latest event per asset ───────────────────────────
create view public.equipment_asset_status
with (security_invoker = true)
as
select distinct on (e.asset_id)
  e.*,
  case e.kind
    when 'checked_out' then 'in_transit'
    when 'picked_up' then 'returning'
    when 'reported_missing' then 'missing'
    when 'returned' then 'available'
    when 'canceled' then 'available'
    else 'on_unit'
  end as status
from public.equipment_custody_events e
order by e.asset_id, e.seq desc;

-- ── updated_at ───────────────────────────────────────────────────────
create trigger equipment_types_touch_updated_at
  before update on public.equipment_types
  for each row execute function public.touch_updated_at();
create trigger equipment_assets_touch_updated_at
  before update on public.equipment_assets
  for each row execute function public.touch_updated_at();
create trigger equipment_checkouts_touch_updated_at
  before update on public.equipment_checkouts
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.equipment_types enable row level security;
alter table public.equipment_assets enable row level security;
alter table public.equipment_handlers enable row level security;
alter table public.equipment_checkouts enable row level security;
alter table public.equipment_checkout_items enable row level security;
alter table public.equipment_custody_events enable row level security;

create policy "equipment_types select" on public.equipment_types
  for select to authenticated using (true);
create policy "equipment_types handler write" on public.equipment_types
  for all to authenticated
  using (public.is_equipment_handler())
  with check (public.is_equipment_handler());

create policy "equipment_assets select" on public.equipment_assets
  for select to authenticated using (true);
create policy "equipment_assets handler write" on public.equipment_assets
  for all to authenticated
  using (public.is_equipment_handler())
  with check (public.is_equipment_handler());

create policy "equipment_handlers select" on public.equipment_handlers
  for select to authenticated using (true);
create policy "equipment_handlers admin write" on public.equipment_handlers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Check-outs: everyone reads; handlers may fix the details (purpose,
-- unit, date, note — column grant below). Rows are created by the RPC.
create policy "equipment_checkouts select" on public.equipment_checkouts
  for select to authenticated using (true);
create policy "equipment_checkouts handler update" on public.equipment_checkouts
  for update to authenticated
  using (public.is_equipment_handler())
  with check (public.is_equipment_handler());

create policy "equipment_checkout_items select" on public.equipment_checkout_items
  for select to authenticated using (true);

-- Custody log: read-only to clients; the RPCs are the only writers.
create policy "equipment_custody_events select" on public.equipment_custody_events
  for select to authenticated using (true);

-- ── grants (house rule: RLS alone is not enough) ─────────────────────
revoke all on public.equipment_types, public.equipment_assets,
  public.equipment_handlers, public.equipment_checkouts,
  public.equipment_checkout_items, public.equipment_custody_events,
  public.equipment_asset_status
  from anon, authenticated;

grant select, insert, update, delete on public.equipment_types to authenticated;
grant select, insert, update, delete on public.equipment_assets to authenticated;
grant select, insert, delete on public.equipment_handlers to authenticated;
grant select on public.equipment_checkouts to authenticated;
grant update (purpose, destination, event_date, note) on public.equipment_checkouts to authenticated;
grant select on public.equipment_checkout_items to authenticated;
grant select on public.equipment_custody_events to authenticated;
grant select on public.equipment_asset_status to authenticated;

grant all on public.equipment_types, public.equipment_assets,
  public.equipment_handlers, public.equipment_checkouts,
  public.equipment_checkout_items, public.equipment_custody_events,
  public.equipment_asset_status
  to service_role;

-- ── RPC: check out a batch of items to a unit ────────────────────────
create or replace function public.equipment_check_out(
  p_asset_ids uuid[],
  p_purpose text,
  p_destination text,
  p_event_date date default null,
  p_note text default ''
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
    raise exception 'Add the unit it''s going to.' using errcode = '22023';
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
    raise exception 'Already checked out: %. Refresh and pick again.', v_bad
      using errcode = '22023';
  end if;

  select full_name into v_me_name from public.app_users where id = v_me;

  insert into public.equipment_checkouts
    (purpose, destination, event_date, note, created_by, created_by_name)
  values
    (v_purpose, v_dest, p_event_date, v_note, v_me, coalesce(v_me_name, ''))
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
revoke all on function public.equipment_check_out(uuid[], text, text, date, text) from public, anon;
grant execute on function public.equipment_check_out(uuid[], text, text, date, text) to authenticated;

-- ── RPC: record the next custody step for items on a check-out ───────
-- p_kind: delivered | canceled | confirmed_present | event_closed |
--         picked_up | returned. The on-shift confirmation may also list
-- p_missing_ids — items the crew could not find — which are logged as
-- reported_missing under the same action.
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
      v_from := array['picked_up']; v_needs_handler := true; v_dest := 'Admin';
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

  -- Close the check-out once every item is back on the shelf.
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
         and l.kind not in ('returned', 'canceled')
     );

  return v_action;
end;
$$;
revoke all on function public.equipment_record(uuid, text, uuid[], text, text, uuid, text, uuid[]) from public, anon;
grant execute on function public.equipment_record(uuid, text, uuid[], text, text, uuid, text, uuid[]) to authenticated;

-- ── photo evidence bucket (private; read via signed URLs) ────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipment-photos', 'equipment-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy "equipment-photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'equipment-photos');
create policy "equipment-photos write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'equipment-photos' and not public.is_kiosk_user());
create policy "equipment-photos admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'equipment-photos' and public.is_admin());

-- ── realtime (the live "where is everything" board) ──────────────────
alter publication supabase_realtime add table
  public.equipment_types,
  public.equipment_assets,
  public.equipment_handlers,
  public.equipment_checkouts,
  public.equipment_custody_events;

-- ── seed: starter types (renamable / extendable in-app) ─────────────
insert into public.equipment_types (name, sort) values
  ('Radio', 1),
  ('iPad', 2);
