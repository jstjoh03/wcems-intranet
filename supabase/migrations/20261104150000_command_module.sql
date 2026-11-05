-- Command module (2026-11-04, applied live): shift handoff notes, fleet
-- list, and the native Supervisor Daily Summary. Access = command staff,
-- which is exactly is_supervisor() (role supervisor OR admin — Rhonda B
-- and April M are admins, so the named command staff are all covered).
-- side 'all' = one supervisor covering the whole county (same day never
-- carries 'all' AND a side row; the unique(shift_date, side) plus the
-- form's status line keep that visible).

create table command_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references app_users(id),
  note text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table command_notes enable row level security;
create policy "command notes read" on command_notes for select to authenticated using (is_supervisor());
create policy "command notes insert" on command_notes for insert to authenticated
  with check (is_supervisor() and author_id = (select id from app_users where auth_user_id = auth.uid()));
create policy "command notes update" on command_notes for update to authenticated
  using (is_admin() or author_id = (select id from app_users where auth_user_id = auth.uid()));
create policy "command notes delete" on command_notes for delete to authenticated
  using (is_admin() or author_id = (select id from app_users where auth_user_id = auth.uid()));
grant select, insert, update, delete on command_notes to authenticated;
grant all on command_notes to service_role;

create table command_fleet (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  sort int not null default 100,
  active boolean not null default true
);
alter table command_fleet enable row level security;
create policy "command fleet read" on command_fleet for select to authenticated using (is_supervisor());
create policy "command fleet admin" on command_fleet for all to authenticated using (is_admin());
grant select, insert, update, delete on command_fleet to authenticated;
grant all on command_fleet to service_role;

insert into command_fleet (label, sort) values
  ('8751', 10), ('9238', 20), ('0081', 30), ('8237', 40), ('8744', 50),
  ('8750', 60), ('Vannie Mae', 70), ('2795', 80), ('2793', 90),
  ('0379', 100), ('8665', 110), ('2794', 120);

create table sup_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  side text not null check (side in ('north','south','all')),
  shift_letter text,
  supervisor_id uuid references app_users(id),
  chart_audits int,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_date, side)
);
alter table sup_daily_summaries enable row level security;
create policy "daily summaries read" on sup_daily_summaries for select to authenticated using (is_supervisor());
create policy "daily summaries insert" on sup_daily_summaries for insert to authenticated with check (is_supervisor());
create policy "daily summaries update" on sup_daily_summaries for update to authenticated using (is_supervisor());
create policy "daily summaries delete" on sup_daily_summaries for delete to authenticated using (is_admin());
grant select, insert, update, delete on sup_daily_summaries to authenticated;
grant all on sup_daily_summaries to service_role;

-- PDF archive bucket (private; command staff read/write).
insert into storage.buckets (id, name, public) values ('daily-summaries', 'daily-summaries', false)
on conflict (id) do nothing;
create policy "daily summaries pdf read" on storage.objects for select to authenticated
  using (bucket_id = 'daily-summaries' and is_supervisor());
create policy "daily summaries pdf write" on storage.objects for insert to authenticated
  with check (bucket_id = 'daily-summaries' and is_supervisor());
create policy "daily summaries pdf replace" on storage.objects for update to authenticated
  using (bucket_id = 'daily-summaries' and is_supervisor());
