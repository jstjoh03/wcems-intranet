-- Applied 2026-08-11 via Supabase MCP (spotlight_multi_person).
-- Multi-person spotlights: person_name stays the rendered display
-- string; person_names carries individual roster names for pushes.
alter table public.spotlights
  add column if not exists person_names text[] not null default '{}';
