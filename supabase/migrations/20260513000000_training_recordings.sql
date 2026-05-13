-- Training Recordings library.
--
-- Phase 1: a browsable video library for past trainings (protocol updates,
-- Doc Day recordings, skills refreshers). Admins paste a URL from wherever
-- the video lives (Wix CDN, SharePoint embed, YouTube unlisted, etc.) and
-- the crew page plays it inline.
--
-- Phase 2 (not in this migration) will layer required-training tracking on
-- top — attestation, signature, certificate, completion roster. The schema
-- here is intentionally source-agnostic so adding Cloudflare Stream or
-- another host later doesn't require touching what's already stored.

create table public.training_recordings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  instructor text,
  recorded_at date,
  duration_minutes int,
  category text,                    -- 'Protocols', 'Doc Day', 'Skills', etc. — free text
  thumbnail_url text,               -- optional; YouTube videos auto-fall-back client-side
  video_source text not null
    check (video_source in ('wix', 'sharepoint', 'youtube', 'direct', 'cloudflare_stream')),
  video_ref text not null,          -- URL or ID depending on source
  visible_to_roles text[] not null default array['crew','supervisor','admin'],
  view_count int not null default 0,
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index training_recordings_active_recorded_at_idx
  on public.training_recordings (active, recorded_at desc);
create index training_recordings_category_idx
  on public.training_recordings (category);

alter table public.training_recordings enable row level security;

-- Admins do everything.
create policy "training_recordings_admin_all"
  on public.training_recordings for all
  using (public.is_admin())
  with check (public.is_admin());

-- Everyone else reads active recordings whose visible_to_roles includes
-- their role. Inactive rows are hidden from non-admins.
-- NB: `app_users.role` is the `public.app_role` enum, not text, so we
-- cast it to text before comparing against the text[] column.
create policy "training_recordings_role_select"
  on public.training_recordings for select
  using (
    active = true
    and exists (
      select 1 from public.app_users u
      where u.id = public.current_app_user_id()
      and u.role::text = any (training_recordings.visible_to_roles)
    )
  );

-- View-counter RPC. RLS would block a normal UPDATE from a non-admin
-- because they don't own the row, so we wrap the increment in a
-- security-definer function. Set search_path explicitly so an attacker
-- can't shadow `public` via session settings.
create or replace function public.increment_training_recording_view(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.training_recordings
  set view_count = view_count + 1
  where id = p_id;
end;
$$;

grant execute on function public.increment_training_recording_view(uuid) to authenticated;

-- updated_at maintenance trigger (mirrors the pattern used on other
-- admin-managed tables).
create or replace function public.training_recordings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger training_recordings_set_updated_at
  before update on public.training_recordings
  for each row execute function public.training_recordings_touch_updated_at();

-- Realtime so admin changes propagate instantly to crew screens.
alter publication supabase_realtime add table public.training_recordings;

-- Public-read bucket for the (optional) admin-uploaded thumbnails. The
-- thumbnail URL itself is just a string column on the table, so an admin
-- can also paste a URL from anywhere else (YouTube thumbnail, Wix media,
-- SharePoint preview) and skip the upload entirely.
insert into storage.buckets (id, name, public)
values ('training-recording-thumbnails', 'training-recording-thumbnails', true)
on conflict (id) do nothing;

create policy "training_recording_thumbnails_public_read"
  on storage.objects for select
  using (bucket_id = 'training-recording-thumbnails');

create policy "training_recording_thumbnails_admin_write"
  on storage.objects for insert
  with check (bucket_id = 'training-recording-thumbnails' and public.is_admin());

create policy "training_recording_thumbnails_admin_update"
  on storage.objects for update
  using (bucket_id = 'training-recording-thumbnails' and public.is_admin());

create policy "training_recording_thumbnails_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'training-recording-thumbnails' and public.is_admin());
