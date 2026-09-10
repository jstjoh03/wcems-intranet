-- Kudos Jotform → portal bridge: every submission is stored here and
-- emailed to the CDO by the jotform-kudos edge function. Form-agnostic
-- (fields jsonb carries label → answer pairs), so the Jotform can
-- change without a schema change.
create table public.kudos_submissions (
  id uuid primary key default gen_random_uuid(),
  jotform_id text unique,
  form_id text,
  form_title text,
  submitted_at timestamptz not null default now(),
  fields jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.kudos_submissions enable row level security;

create policy "kudos_select_admins" on public.kudos_submissions
  for select to authenticated
  using (public.is_admin() or public.is_pipeline_editor());

grant select on public.kudos_submissions to authenticated;
grant all on public.kudos_submissions to service_role;
