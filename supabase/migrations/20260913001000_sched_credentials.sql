-- Internal credential shown after names on the schedule (Supervisor,
-- EMT, AEMT, P1C, P1, P2, P3, EMT-FTO, P2-FTO, P3-FTO) — editable on
-- the Members tab. Public within the module, unlike member settings.
create table public.sched_credentials (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  credential text not null check (credential in
    ('Supervisor','EMT','AEMT','P1C','P1','P2','P3','EMT-FTO','P2-FTO','P3-FTO')),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);

alter table public.sched_credentials enable row level security;
create policy "creds read" on public.sched_credentials for select to authenticated
  using (public.sched_level() <> 'none');
create policy "creds write" on public.sched_credentials for all to authenticated
  using (public.sched_can_edit()) with check (public.sched_can_edit());

grant all on public.sched_credentials to authenticated;
grant all on public.sched_credentials to service_role;
