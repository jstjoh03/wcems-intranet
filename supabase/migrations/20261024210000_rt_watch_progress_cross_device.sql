-- Cross-device watch progress for required-training videos (Justin,
-- 2026-10-24): the completion row (created at first play) carries the
-- furthest-watched position and when the video finished, so a video
-- watched to the end on one device unlocks the attestation on another.
-- RLS already allows self insert/update on this table.
alter table public.required_training_completions
  add column if not exists watch_seconds numeric not null default 0,
  add column if not exists video_completed_at timestamptz;
