-- Tags column + category cleanup for training_recordings.
--
-- Tags are an open-ended secondary axis for cross-cutting discovery
-- (e.g. ["cardiac", "pediatric", "2026"] on a Doc Day recording).
-- Distinct from category, which is a strict single-pick dropdown the
-- admin form now enforces from a preset list.
--
-- The same form also gets a one-time auto-rename for existing rows
-- whose category was "Protocols" → "Protocol Updates" so they line up
-- with the new preset. "Community Paramedicine" already matches.

alter table public.training_recordings
  add column if not exists tags text[] not null default array[]::text[];

-- GIN index makes tag containment queries (?, &&, @>) free to add
-- later (e.g. "show me everything tagged 'cardiac'"). We don't run
-- those queries yet, but the index is cheap and avoids a follow-up
-- migration when we do.
create index if not exists training_recordings_tags_idx
  on public.training_recordings using gin (tags);

-- One-time category rename so existing rows pick up the new preset
-- label without the admin having to re-edit them. Safe to re-run.
update public.training_recordings
  set category = 'Protocol Updates'
  where category = 'Protocols';
