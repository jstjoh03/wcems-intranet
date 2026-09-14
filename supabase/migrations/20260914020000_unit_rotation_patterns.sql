-- Per-unit rotation patterns. Null = the agency default 48/96
-- (B,B,C,C,A,A anchored 2026-04-06). A custom unit (e.g. a future
-- part-time truck) sets its own repeating day sequence of platoon
-- letters, '' meaning the unit is not staffed that day, anchored to
-- rotation_anchor (defaults to the agency anchor when null).
alter table public.sched_units
  add column rotation_pattern text[]
    check (rotation_pattern is null or rotation_pattern <@ array['A','B','C','']::text[]),
  add column rotation_anchor date;
