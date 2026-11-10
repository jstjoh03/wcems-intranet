-- PIP round 2 (2026-11-10, from Heather's paper PIP): the plan gets the
-- document's real structure — areas of concern, improvement goals,
-- expectations, requirements/cadence, what success looks like, and the
-- consequences paragraph — plus an explicit 30/60/90 length. Checkpoint
-- deadlines stay in pip_targets (the paper's Progress Checkpoints
-- table). Reminders now also reach the pip_admins who opted in
-- (notify flag — seeded on for Justin + Heather, editable in-app).
alter table public.pips
  add column if not exists length_days int,
  add column if not exists areas_of_concern text,
  add column if not exists goals text,
  add column if not exists expectations text,
  add column if not exists requirements text,
  add column if not exists success_criteria text,
  add column if not exists consequences text;

alter table public.pip_admins
  add column if not exists notify boolean not null default false;

update public.pip_admins set notify = true
where user_id in (
  select id from public.app_users
  where lower(email) in (
    'justin.stjohn@wallercountyems.com',
    'heather.fojt@wallercountyems.com'
  )
);
