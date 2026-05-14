-- ─────────────────────────────────────────────────────────────────────
-- Announcements table + image bucket.
--
-- Dashboard "Announcements" card has been a local-Vue-ref ephemeral
-- prototype since launch — `+ New` mutated an in-memory list and
-- disappeared on refresh. This migration backs the card with real
-- persistence and adds image_url so admins can post flyers, event
-- invitations, etc.
--
-- Visibility model:
--   - Read: every authenticated user, active rows only. Inactive rows
--     are admin-only (soft-delete bucket).
--   - Write: admins only.
--
-- Realtime publication so new posts and edits appear on every signed-in
-- user's dashboard within seconds.
-- ─────────────────────────────────────────────────────────────────────

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  tag text not null default 'Operations',
  title text not null,
  body text,
  image_url text,
  author_name text not null,
  author_user_id uuid references public.app_users(id) on delete set null,
  published_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_active_published_at_idx
  on public.announcements (active, published_at desc);

drop trigger if exists announcements_touch_updated_at on public.announcements;
create trigger announcements_touch_updated_at
  before update on public.announcements
  for each row execute function public.touch_updated_at();

alter table public.announcements enable row level security;

create policy "announcements read active"
  on public.announcements for select
  to authenticated
  using (active = true or public.is_admin());

create policy "announcements admin all"
  on public.announcements for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.announcements to authenticated;
grant all on public.announcements to service_role;

-- Realtime — same pattern as other admin-managed tables. Crew dashboards
-- pick up new posts without a refresh.
alter publication supabase_realtime add table public.announcements;

-- ─────────────────────────────────────────────────────────────────────
-- Storage bucket for announcement images. Public-read so the dashboard
-- renders without a signed-URL round-trip per post.
-- ─────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('announcement-images', 'announcement-images', true)
on conflict (id) do nothing;

drop policy if exists "announcement-images public read" on storage.objects;
create policy "announcement-images public read"
  on storage.objects for select
  to public
  using (bucket_id = 'announcement-images');

drop policy if exists "announcement-images admin insert" on storage.objects;
create policy "announcement-images admin insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'announcement-images' and public.is_admin());

drop policy if exists "announcement-images admin update" on storage.objects;
create policy "announcement-images admin update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'announcement-images' and public.is_admin())
  with check (bucket_id = 'announcement-images' and public.is_admin());

drop policy if exists "announcement-images admin delete" on storage.objects;
create policy "announcement-images admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'announcement-images' and public.is_admin());
