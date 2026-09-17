-- Shift reminders: one row per (member, merged shift start) that has
-- been reminded, so the 15-minute cron sends each reminder exactly once.
-- Written only by the service role (sched-notify 'shift_reminders' kind);
-- editors may read for debugging. Rows are pruned after 14 days.
create table sched_reminders_sent (
  id bigint generated always as identity primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  shift_start timestamptz not null,
  label text,
  sent_at timestamptz not null default now(),
  unique (user_id, shift_start)
);

alter table sched_reminders_sent enable row level security;

create policy "reminders read editors" on sched_reminders_sent
  for select using (sched_can_edit());
