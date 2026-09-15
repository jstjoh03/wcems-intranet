-- Page-out composer round 2 (Justin, 2026-09-15): message type
-- (scheduling page-out vs plain announcement), an urgent flag for
-- last-minute callouts, and the attached open shifts stored as
-- STRUCTURED items instead of baked into the message text — the
-- notify function renders them as tappable pickup links and builds
-- the dynamic email subject ("<position> needed on <unit>") from them.
alter table public.sched_pages
  add column message_type text not null default 'scheduling'
    check (message_type in ('scheduling', 'announcement')),
  add column urgent boolean not null default false,
  add column shifts jsonb not null default '[]'::jsonb;
