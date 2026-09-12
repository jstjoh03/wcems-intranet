-- ═════════════════════════════════════════════════════════════════════
-- SCHEDULING MODULE · core schema (Aladtec replacement)
--
-- Design locked via mockup v7 (2026-09-12). Principles:
--   · The rotation template + pattern GENERATE the calendar; days are
--     materialized into sched_entries ~90 days ahead. Requests and
--     edits change ENTRIES (or template rows with effective dates) —
--     worked history is never rewritten.
--   · Every mutation is audit-logged (who/what/when).
--   · Access: Global admin (everything) · Scheduler (edit schedule,
--     students, events, page-outs) · Supervisor (view + page-out;
--     derived from app_users.role) · Member (view; own requests).
--     Students never get access (no student accounts in app_users).
--   · Qualification rules per seat enforce from the clinical pipeline
--     (P2 for in-charge, AIC-or-P2 for M231, Supervisor role for
--     S-seats), with manual override in sched_member_quals.
-- ═════════════════════════════════════════════════════════════════════

-- ── access grants ────────────────────────────────────────────────────
create table public.sched_access (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  level text not null check (level in ('global_admin','scheduler')),
  created_at timestamptz not null default now()
);

create or replace function public.sched_level()
returns text
language sql security definer set search_path = public stable
as $$
  select coalesce(
    (select a.level from public.sched_access a
      join public.app_users u on u.id = a.user_id
     where u.auth_user_id = auth.uid()),
    case when exists (
      select 1 from public.app_users u
      where u.auth_user_id = auth.uid()
        and u.active and u.role in ('admin','supervisor')
    ) then 'supervisor' else 'member' end
  );
$$;
grant execute on function public.sched_level() to authenticated;

create or replace function public.sched_can_edit()
returns boolean
language sql security definer set search_path = public stable
as $$ select public.sched_level() in ('global_admin','scheduler'); $$;
grant execute on function public.sched_can_edit() to authenticated;

-- ── units & seats (in-app editable; display order matters) ──────────
create table public.sched_units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- 'M211', 'S201'
  label text not null default '',       -- 'Medic 211'
  station text not null default '',     -- 'Station 201 · Hempstead'
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.sched_seats (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.sched_units(id) on delete cascade,
  label text not null,                  -- 'Paramedic' | 'Attendant' | 'AIC / Medic' | 'Supervisor'
  qual_rule text not null default 'any_field'
    check (qual_rule in ('p2','aic_or_p2','any_field','supervisor','any')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index sched_seats_unit_idx on public.sched_seats(unit_id);

-- ── per-member scheduler settings (quals override + notifications) ──
create table public.sched_member_settings (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  qual_overrides jsonb not null default '{}'::jsonb,   -- {seat_id: true/false} manual allow/deny
  unit_exclusions uuid[] not null default '{}',        -- units they never work
  notify jsonb not null default '{}'::jsonb,           -- {msgType: {push,email,sms}}
  sms_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ── rotation template (effective-dated; platoon A/B/C) ───────────────
create table public.sched_rotation_assignments (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid not null references public.sched_seats(id) on delete cascade,
  platoon text not null check (platoon in ('A','B','C')),
  user_id uuid references public.app_users(id) on delete set null,  -- null = open seat
  effective_from date not null,
  effective_to date,                                   -- null = indefinite
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);
create index sched_rot_seat_idx on public.sched_rotation_assignments(seat_id, platoon, effective_from);

-- ── materialized daily entries (the schedule itself) ─────────────────
create table public.sched_entries (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,               -- shift START date (0600 changeover)
  seat_id uuid references public.sched_seats(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,  -- null + status 'open' = open seat
  start_at timestamptz not null,
  end_at timestamptz not null,
  kind text not null default 'rotation'
    check (kind in ('rotation','pickup','trade','giveaway_cover','extra','event','student','timeoff')),
  status text not null default 'scheduled'
    check (status in ('scheduled','open','off')),
  off_type text check (off_type in ('vacation','sick','unpaid','bereavement','other')),
  time_type text not null default 'regular' check (time_type in ('regular','instructor','meeting')),
  event_id uuid,
  student_program text,
  unit_id uuid references public.sched_units(id) on delete set null,
  note text,
  source_request uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sched_entries_date_idx on public.sched_entries(work_date);
create index sched_entries_unit_idx on public.sched_entries(unit_id, work_date);
create index sched_entries_user_idx on public.sched_entries(user_id, work_date);
create index sched_entries_seat_idx on public.sched_entries(seat_id, work_date);

-- ── requests (pickup / trade / giveaway / time off / extra hours) ────
create table public.sched_requests (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('pickup','trade','giveaway','time_off','extra_hours')),
  status text not null default 'pending'
    check (status in ('pending','partner_accepted','approved','denied','cancelled')),
  requester_id uuid not null references public.app_users(id) on delete cascade,
  counterparty_id uuid references public.app_users(id) on delete set null,
  -- what the request touches (interpretation depends on type):
  entry_id uuid references public.sched_entries(id) on delete set null,
  counter_entry_id uuid references public.sched_entries(id) on delete set null,
  seat_id uuid references public.sched_seats(id) on delete set null,
  work_date date,
  start_at timestamptz,
  end_at timestamptz,
  off_type text check (off_type in ('vacation','sick','unpaid','bereavement','other')),
  time_type text check (time_type in ('regular','instructor','meeting')),
  unit_code text,
  position_label text,
  comments text,
  warnings jsonb not null default '[]'::jsonb,   -- computed at submit; shown to Chief
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sched_requests_status_idx on public.sched_requests(status, created_at desc);
create index sched_requests_requester_idx on public.sched_requests(requester_id, created_at desc);

-- ── availability (protected days off; no approval, warns the Chief) ──
create table public.sched_availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  on_date date not null,
  start_at timestamptz,
  end_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, on_date)
);

-- ── special events ───────────────────────────────────────────────────
create table public.sched_events (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  on_date date not null,
  end_date date,
  start_time time not null default '06:00',
  end_time time not null default '06:00',
  seats_total int not null default 1,
  notes text,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

-- ── unit/day notes (shift reminders) ─────────────────────────────────
create table public.sched_day_notes (
  id uuid primary key default gen_random_uuid(),
  on_date date not null,
  unit_id uuid references public.sched_units(id) on delete cascade,
  note text not null,
  include_in_reminders boolean not null default false,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);
create index sched_day_notes_date_idx on public.sched_day_notes(on_date);

-- ── page-outs & claims (ordered queue; no auto-assign) ───────────────
create table public.sched_pages (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  channels jsonb not null default '{"push":true,"email":true,"sms":true}'::jsonb,
  audience jsonb not null default '{}'::jsonb,      -- groups + explicit add/remove
  entry_ids uuid[] not null default '{}',           -- open seats included
  recipients uuid[] not null default '{}',          -- resolved at send
  delivery jsonb not null default '{}'::jsonb,      -- counts per channel
  sent_by uuid references public.app_users(id),
  sent_at timestamptz not null default now()
);

create table public.sched_page_claims (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references public.sched_pages(id) on delete set null,
  entry_id uuid not null references public.sched_entries(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  start_at timestamptz,                              -- partial claims
  end_at timestamptz,
  note text,
  status text not null default 'queued' check (status in ('queued','assigned','passed','withdrawn')),
  unique (entry_id, user_id)
);
create index sched_page_claims_entry_idx on public.sched_page_claims(entry_id, claimed_at);

-- ── settings & audit ─────────────────────────────────────────────────
create table public.sched_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);

insert into public.sched_settings (key, value) values
  ('rotation', '{"pattern":["B","B","C","C","A","A"],"anchor":"2026-04-06","changeover":"06:00","horizon_days":90}'),
  ('pay', '{"period_days":14,"period_anchor":"2026-09-01","workday_start":"06:00","ot_week_hours":40,"double_time_types":["instructor","meeting"]}'),
  ('warnings', '{"consecutive_warn_hours":60,"consecutive_confirm_hours":72,"weekly_warn_hours":84}');

create table public.sched_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references public.app_users(id),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb
);
create index sched_audit_at_idx on public.sched_audit(at desc);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.sched_access enable row level security;
alter table public.sched_units enable row level security;
alter table public.sched_seats enable row level security;
alter table public.sched_member_settings enable row level security;
alter table public.sched_rotation_assignments enable row level security;
alter table public.sched_entries enable row level security;
alter table public.sched_requests enable row level security;
alter table public.sched_availability enable row level security;
alter table public.sched_events enable row level security;
alter table public.sched_day_notes enable row level security;
alter table public.sched_pages enable row level security;
alter table public.sched_page_claims enable row level security;
alter table public.sched_settings enable row level security;
alter table public.sched_audit enable row level security;

-- everyone signed in can READ the schedule world
create policy "sched read all" on public.sched_access for select to authenticated using (true);
create policy "units read" on public.sched_units for select to authenticated using (true);
create policy "seats read" on public.sched_seats for select to authenticated using (true);
create policy "rot read" on public.sched_rotation_assignments for select to authenticated using (true);
create policy "entries read" on public.sched_entries for select to authenticated using (true);
create policy "events read" on public.sched_events for select to authenticated using (true);
create policy "notes read" on public.sched_day_notes for select to authenticated using (true);
create policy "settings read" on public.sched_settings for select to authenticated using (true);
create policy "avail read" on public.sched_availability for select to authenticated using (true);
create policy "pages read" on public.sched_pages for select to authenticated using (true);
create policy "claims read" on public.sched_page_claims for select to authenticated using (true);
create policy "audit read admins" on public.sched_audit for select to authenticated using (public.sched_can_edit());

-- requests: everyone sees their own; editors see all; supervisors see all (context for the board)
create policy "requests read" on public.sched_requests for select to authenticated
  using (public.sched_can_edit()
         or public.sched_level() = 'supervisor'
         or requester_id = public.current_app_user_id()
         or counterparty_id = public.current_app_user_id());

-- member settings: own row + editors
create policy "msettings read" on public.sched_member_settings for select to authenticated
  using (user_id = public.current_app_user_id() or public.sched_can_edit());
create policy "msettings own write" on public.sched_member_settings for all to authenticated
  using (user_id = public.current_app_user_id() or public.sched_can_edit())
  with check (user_id = public.current_app_user_id() or public.sched_can_edit());

-- editors write the schedule world
create policy "access write" on public.sched_access for all to authenticated
  using (public.sched_level() = 'global_admin') with check (public.sched_level() = 'global_admin');
create policy "units write" on public.sched_units for all to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());
create policy "seats write" on public.sched_seats for all to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());
create policy "rot write" on public.sched_rotation_assignments for all to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());
create policy "entries write" on public.sched_entries for all to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());
create policy "events write" on public.sched_events for all to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());
create policy "notes write" on public.sched_day_notes for all to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());
create policy "settings write" on public.sched_settings for all to authenticated
  using (public.sched_level() = 'global_admin') with check (public.sched_level() = 'global_admin');

-- requests: crew create their own; edit/cancel while pending; editors decide
create policy "requests insert own" on public.sched_requests for insert to authenticated
  with check (requester_id = public.current_app_user_id() or public.sched_can_edit());
create policy "requests update" on public.sched_requests for update to authenticated
  using (public.sched_can_edit()
         or (requester_id = public.current_app_user_id() and status = 'pending')
         or (counterparty_id = public.current_app_user_id() and status = 'pending'))
  with check (true);

-- availability: own rows; editors may clear
create policy "avail write own" on public.sched_availability for all to authenticated
  using (user_id = public.current_app_user_id() or public.sched_can_edit())
  with check (user_id = public.current_app_user_id() or public.sched_can_edit());

-- page-outs: editors AND supervisors may send
create policy "pages write" on public.sched_pages for insert to authenticated
  with check (public.sched_can_edit() or public.sched_level() = 'supervisor');

-- claims: crew claim for themselves; editors manage
create policy "claims insert own" on public.sched_page_claims for insert to authenticated
  with check (user_id = public.current_app_user_id() or public.sched_can_edit());
create policy "claims update" on public.sched_page_claims for update to authenticated
  using (public.sched_can_edit() or user_id = public.current_app_user_id())
  with check (true);

-- audit: inserts via service/definer paths only (no direct client policy)

-- grants (house rule: RLS alone is not enough — table grants required)
grant all on public.sched_access, public.sched_units, public.sched_seats,
  public.sched_member_settings, public.sched_rotation_assignments,
  public.sched_entries, public.sched_requests, public.sched_availability,
  public.sched_events, public.sched_day_notes, public.sched_pages,
  public.sched_page_claims, public.sched_settings to authenticated;
grant all on public.sched_audit to service_role;
grant usage, select on sequence public.sched_audit_id_seq to service_role;
grant all on public.sched_access, public.sched_units, public.sched_seats,
  public.sched_member_settings, public.sched_rotation_assignments,
  public.sched_entries, public.sched_requests, public.sched_availability,
  public.sched_events, public.sched_day_notes, public.sched_pages,
  public.sched_page_claims, public.sched_settings to service_role;

-- ── seed: units, seats, and access ───────────────────────────────────
insert into public.sched_units (code, label, station, sort_order) values
  ('S201', 'Station 201 Supervisor', 'Station 201 · Hempstead', 0),
  ('M211', 'Medic 211', 'Station 201 · Hempstead', 1),
  ('M221', 'Medic 221', 'Station 201 · Hempstead', 2),
  ('M242', 'Medic 242', 'Station 201 · Hempstead', 3),
  ('M281', 'Medic 281', 'Station 201 · Hempstead', 4),
  ('S202', 'Station 202 Supervisor', 'Station 202 · Waller', 5),
  ('M231', 'Medic 231', 'Station 202 · Waller', 6),
  ('M271', 'Medic 271', 'Station 202 · Waller', 7),
  ('M272', 'Medic 272', 'Station 202 · Waller', 8),
  ('M206', 'Medic 206', 'Station 202 · Waller', 9);

insert into public.sched_seats (unit_id, label, qual_rule, sort_order)
select u.id, s.label, s.qual, s.ord
from public.sched_units u
join lateral (
  values
    ('Supervisor', 'supervisor', 0)
) s(label, qual, ord) on u.code in ('S201','S202')
union all
select u.id, s.label, s.qual, s.ord
from public.sched_units u
join lateral (
  values
    ('Paramedic', 'p2', 0),
    ('Attendant', 'any_field', 1)
) s(label, qual, ord) on u.code in ('M211','M221','M242','M281','M271','M272','M206')
union all
select u.id, s.label, s.qual, s.ord
from public.sched_units u
join lateral (
  values
    ('AIC / Medic', 'aic_or_p2', 0),
    ('Attendant', 'any_field', 1)
) s(label, qual, ord) on u.code = 'M231';

insert into public.sched_access (user_id, level)
select id, 'global_admin' from public.app_users
 where full_name in ('Rhonda Getschman', 'Justin St John') and account_type = 'person'
on conflict (user_id) do nothing;

insert into public.sched_access (user_id, level)
select id, 'scheduler' from public.app_users
 where full_name = 'Laurel Vandagriff' and account_type = 'person'
on conflict (user_id) do nothing;
