-- Skills Day station-setup equipment lists (2026-10-28, applied live).
-- Each check-off carries its pull list (jsonb array of strings),
-- edited in-app via Setup → station editor and rendered on
-- /skills/station-setup with per-device check-off state.
--
-- Same morning, per Justin (day-of for the Oct 28–29 NEOP days):
--   · LUCAS moved from the Trauma relay into Cardiac Skills
--     ("LUCAS deployment & operation", hands-on section).
--   · LP15 + Cardiac Skills combined as Station 2 (subtitles:
--     First/Second Check-Off); Sapphire IV Pump promoted to Station 4.
--   Data edits live in skills_checkoffs.sections; old evaluations are
--   safe (per-item label snapshots).

alter table public.skills_checkoffs add column if not exists equipment jsonb;

comment on column public.skills_checkoffs.equipment is
  'Station setup pull list (jsonb array of strings) shown on /skills/station-setup; admin-edited in the Setup tab.';
