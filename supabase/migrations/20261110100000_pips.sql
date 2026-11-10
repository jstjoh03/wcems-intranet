-- Performance Improvement Plans (2026-11-10). A real PIP flow replacing
-- the broad pip_active/pip_reason flag on pipeline_records: plan window
-- + target dates, reminder sweeps, a training/progress log, documents,
-- and an FTEP hold. VISIBILITY IS THE POINT: a PIP is readable ONLY by
-- the pip_admins grant list (seeded: Rhonda Getschman, Heather Fojt,
-- Justin St John — managed in-app), the affected employee, and the
-- supervisor named on that PIP. Nothing here writes to the clinical
-- activity feed, and general clinical viewers see only a generic
-- pipeline_records.training_hold flag with no reason attached.

-- ── A) FTEP list signature flags ─────────────────────────────────────
-- Regression fix for 0076d7c (list rows no longer carry signature
-- blobs): the "awaiting trainee signature" gates need a cheap boolean.
alter table public.ftep_reports
  add column if not exists trainee_signed boolean
    generated always as (trainee_signature is not null) stored,
  add column if not exists evaluator_signed boolean
    generated always as (evaluator_signature is not null) stored;

-- ── B) PIP access list ───────────────────────────────────────────────
create table if not exists public.pip_admins (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  added_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

grant select, insert, delete on public.pip_admins to authenticated;
grant all on public.pip_admins to service_role;

create or replace function public.is_pip_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from pip_admins where user_id = current_app_user_id()
  );
$$;

-- RPC the client can call to learn whether to show manage surfaces
create or replace function public.pip_am_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_pip_admin(); $$;

revoke execute on function public.pip_am_admin() from public, anon;
grant execute on function public.pip_am_admin() to authenticated, service_role;

alter table public.pip_admins enable row level security;
create policy pip_admins_select on public.pip_admins
  for select to authenticated using (is_pip_admin());
create policy pip_admins_insert on public.pip_admins
  for insert to authenticated with check (is_pip_admin());
create policy pip_admins_delete on public.pip_admins
  for delete to authenticated using (is_pip_admin());

insert into public.pip_admins (user_id)
select id from public.app_users
where lower(email) in (
  'rhonda.getschman@wallercountyems.com',
  'heather.fojt@wallercountyems.com',
  'justin.stjohn@wallercountyems.com'
)
on conflict (user_id) do nothing;

-- ── C) PIP core tables ───────────────────────────────────────────────
create table if not exists public.pips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  supervisor_user_id uuid references public.app_users(id),
  status text not null default 'active' check (status in ('active', 'completed', 'closed')),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  summary text not null default '',
  ftep_hold boolean not null default false,
  outcome_note text,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.app_users(id)
);

create table if not exists public.pip_targets (
  id uuid primary key default gen_random_uuid(),
  pip_id uuid not null references public.pips(id) on delete cascade,
  due_on date not null,
  title text not null,
  detail text,
  status text not null default 'pending' check (status in ('pending', 'met', 'missed')),
  completed_at timestamptz,
  note text,
  sort int not null default 0
);

create table if not exists public.pip_entries (
  id uuid primary key default gen_random_uuid(),
  pip_id uuid not null references public.pips(id) on delete cascade,
  entry_on date not null default current_date,
  kind text not null default 'note' check (kind in ('training', 'meeting', 'note')),
  body text not null,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.pip_documents (
  id uuid primary key default gen_random_uuid(),
  pip_id uuid not null references public.pips(id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.pips, public.pip_targets, public.pip_entries, public.pip_documents to authenticated;
grant all on public.pips, public.pip_targets, public.pip_entries, public.pip_documents to service_role;

-- the five-party rule, reused by every child table and the bucket
create or replace function public.pip_visible(p_pip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from pips p
    where p.id = p_pip
      and (
        is_pip_admin()
        or p.user_id = current_app_user_id()
        or p.supervisor_user_id = current_app_user_id()
      )
  );
$$;

alter table public.pips enable row level security;
create policy pips_select on public.pips
  for select to authenticated
  using (
    is_pip_admin()
    or user_id = current_app_user_id()
    or supervisor_user_id = current_app_user_id()
  );
create policy pips_write on public.pips
  for insert to authenticated with check (is_pip_admin());
create policy pips_update on public.pips
  for update to authenticated using (is_pip_admin());
create policy pips_delete on public.pips
  for delete to authenticated using (is_pip_admin());

alter table public.pip_targets enable row level security;
create policy pip_targets_select on public.pip_targets
  for select to authenticated using (pip_visible(pip_id));
create policy pip_targets_insert on public.pip_targets
  for insert to authenticated with check (is_pip_admin());
create policy pip_targets_update on public.pip_targets
  for update to authenticated using (is_pip_admin());
create policy pip_targets_delete on public.pip_targets
  for delete to authenticated using (is_pip_admin());

alter table public.pip_entries enable row level security;
create policy pip_entries_select on public.pip_entries
  for select to authenticated using (pip_visible(pip_id));
-- the named supervisor documents training/meetings too
create policy pip_entries_insert on public.pip_entries
  for insert to authenticated
  with check (
    is_pip_admin()
    or exists (
      select 1 from pips p
      where p.id = pip_id and p.supervisor_user_id = current_app_user_id()
    )
  );
create policy pip_entries_update on public.pip_entries
  for update to authenticated using (is_pip_admin());
create policy pip_entries_delete on public.pip_entries
  for delete to authenticated using (is_pip_admin());

alter table public.pip_documents enable row level security;
create policy pip_documents_select on public.pip_documents
  for select to authenticated using (pip_visible(pip_id));
create policy pip_documents_insert on public.pip_documents
  for insert to authenticated with check (is_pip_admin());
create policy pip_documents_delete on public.pip_documents
  for delete to authenticated using (is_pip_admin());

-- ── D) private storage bucket ────────────────────────────────────────
-- Paths are {pip_id}/{filename}; the clinical-docs bucket is NOT used
-- because its read policy opens every object to all pipeline editors.
insert into storage.buckets (id, name, public)
values ('pip-docs', 'pip-docs', false)
on conflict (id) do nothing;

create policy "pip-docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pip-docs'
    and pip_visible(((storage.foldername(name))[1])::uuid)
  );
create policy "pip-docs write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pip-docs' and is_pip_admin());
create policy "pip-docs delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pip-docs' and is_pip_admin());

-- ── E) generic training hold on the pipeline record ──────────────────
-- What general clinical viewers see: a hold, no reason. Maintained by
-- the PIP flow through a definer RPC because PIP admins (e.g. the
-- Chief) are not necessarily pipeline editors.
alter table public.pipeline_records
  add column if not exists training_hold boolean not null default false;

create or replace function public.pip_set_hold(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_pip_admin() then
    raise exception 'PIP access required.';
  end if;
  update pipeline_records
  set training_hold = p_on, updated_at = now()
  where user_id = p_user;
end;
$$;

revoke execute on function public.pip_set_hold(uuid, boolean) from public, anon;
grant execute on function public.pip_set_hold(uuid, boolean) to authenticated, service_role;
