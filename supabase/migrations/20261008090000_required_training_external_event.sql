-- Required Training: external-course content type + schedule-event
-- audiences (Justin, 2026-10-08 — Pulsara Academy course for the
-- Oct 15-17 Special Event crew).
--
-- 'external' video_source = a course hosted elsewhere (Pulsara
-- Academy etc.): the portal records the open + the signed attestation,
-- there is no video to gate.
--
-- audience_event_label/from/to tie a module's audience to the people
-- holding scheduled kind='event' entries for that event label inside
-- the window — live membership, so giveaways/swaps keep the roster
-- honest. When audience_event_label is set it REPLACES the
-- role/shift/employment axes; per-user overrides still win.

alter table public.required_trainings
  drop constraint required_trainings_video_source_check;
alter table public.required_trainings
  add constraint required_trainings_video_source_check
  check (video_source = any (array['youtube'::text, 'cloudflare_stream'::text, 'direct'::text, 'sharepoint'::text, 'external'::text]));

alter table public.required_trainings
  add column if not exists audience_event_label text,
  add column if not exists audience_event_from date,
  add column if not exists audience_event_to date;
