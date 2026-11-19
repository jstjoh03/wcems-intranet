-- ─────────────────────────────────────────────────────────────────────
-- Monthly Training & Education Report — the board-meeting report the
-- education office used to keep in a spreadsheet (WCEMS Training
-- Tracker). Course sessions + attendance assemble each month's rows
-- automatically; these tables hold what the app can't derive:
--   · training_monthly_report_entries — courses added by hand (1-on-1s,
--     outside-hosted classes), plus per-session note/count overrides
--     (session_id set = the entry decorates that auto row instead of
--     being its own row).
--   · training_monthly_reports — one row per month: building → filed.
--     Filing snapshots the assembled rows + summary into jsonb so a
--     filed board report never drifts when attendance is edited later.
--
-- Access: clinical editors (pipeline_editors) + admins — the shared
-- clinical dashboard circle (Justin & Heather), not all supervisors.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.is_clinical_editor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users u
    where u.auth_user_id = auth.uid()
      and u.active
      and (
        u.role = 'admin'
        or exists (select 1 from pipeline_editors e where e.user_id = u.id)
      )
  );
$$;

create table public.training_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,  -- always the first of the month
  status text not null default 'building' check (status in ('building', 'filed')),
  snapshot jsonb,              -- { rows: [...], summary: {...} } frozen at filing
  filed_by uuid references public.app_users(id),
  filed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.training_monthly_report_entries (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  -- Own-row manual course (session_id null), or a decoration of one of
  -- the month's auto rows (session_id = course_sessions.session_id):
  -- notes always apply; non-null counts override what attendance says.
  session_id text,
  happened_on date,
  title text not null default '' check (char_length(title) <= 200),
  in_person int check (in_person is null or in_person >= 0),
  virtual int check (virtual is null or virtual >= 0),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  -- a manual course needs a date + name; an override needs its session
  constraint manual_or_override check (
    (session_id is null and happened_on is not null and char_length(title) >= 1)
    or (session_id is not null)
  )
);

create index training_monthly_report_entries_month_idx
  on public.training_monthly_report_entries (month);

alter table public.training_monthly_reports enable row level security;
alter table public.training_monthly_report_entries enable row level security;

create policy "reports: clinical editors read"
  on public.training_monthly_reports for select
  using (public.is_clinical_editor());
create policy "reports: clinical editors write"
  on public.training_monthly_reports for insert
  with check (public.is_clinical_editor());
create policy "reports: clinical editors update"
  on public.training_monthly_reports for update
  using (public.is_clinical_editor());
create policy "reports: clinical editors delete"
  on public.training_monthly_reports for delete
  using (public.is_clinical_editor());

create policy "report entries: clinical editors read"
  on public.training_monthly_report_entries for select
  using (public.is_clinical_editor());
create policy "report entries: clinical editors write"
  on public.training_monthly_report_entries for insert
  with check (public.is_clinical_editor());
create policy "report entries: clinical editors update"
  on public.training_monthly_report_entries for update
  using (public.is_clinical_editor());
create policy "report entries: clinical editors delete"
  on public.training_monthly_report_entries for delete
  using (public.is_clinical_editor());

-- Explicit grants (RLS is the gate; a missing grant has bitten before).
grant select, insert, update, delete on public.training_monthly_reports to authenticated;
grant select, insert, update, delete on public.training_monthly_report_entries to authenticated;
grant all on public.training_monthly_reports to service_role;
grant all on public.training_monthly_report_entries to service_role;
