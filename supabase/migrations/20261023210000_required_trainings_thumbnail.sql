-- Optional card/hero image for a required-training module (Justin,
-- 2026-10-23). Uploads reuse the public training-recording-thumbnails
-- bucket; this column just points at the public URL.
alter table public.required_trainings add column if not exists thumbnail_url text;
