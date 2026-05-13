-- ─────────────────────────────────────────────────────────────────────
-- Profile photos on app_users + matching Storage bucket.
--
-- Users upload via the profile modal; admins can upload on anyone's
-- behalf via /admin/employees (any-image input there — not gated by
-- this bucket). Photos appear wherever the Avatar primitive renders:
-- directory cards, user dropdown trigger, dropdown panel header, nav
-- drawer footer, etc.
--
-- Storage layout: `<app_users.id>/<random>.<ext>`. The first folder
-- segment IS the app_users.id, and the RLS policies key off that —
-- a user can only write into their own folder; admins can write
-- anywhere in the bucket. Public read so directory cards render
-- without a signed-URL round-trip per face.
--
-- photo_url is self-editable. The column-lock trigger uses an explicit
-- deny-list (email/role/title/fuel_number/etc.); photo_url isn't in
-- that list, so non-admin self-updates pass through. The Vue auth
-- store's updateOwnPhotoUrl action is the canonical write path.
-- ─────────────────────────────────────────────────────────────────────

alter table public.app_users
  add column if not exists photo_url text;

-- Refresh the directory function to include the photo column. CREATE OR
-- REPLACE swaps the body in place; existing GRANT EXECUTE survives.
create or replace function public.get_employee_directory()
returns table (
  id uuid,
  full_name text,
  first_name text,
  last_name text,
  title text,
  role public.app_role,
  shift public.shift_letter,
  station text,
  email text,
  phone text,
  photo_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    id,
    full_name,
    first_name,
    last_name,
    title,
    role,
    shift,
    station,
    email,
    phone,
    photo_url
  from public.app_users
  where active = true and in_directory = true
  order by full_name asc;
$$;

grant execute on function public.get_employee_directory() to authenticated;

-- Storage bucket ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('app-user-photos', 'app-user-photos', true)
on conflict (id) do nothing;

drop policy if exists "app-user-photos public read" on storage.objects;
create policy "app-user-photos public read"
  on storage.objects for select
  to public
  using (bucket_id = 'app-user-photos');

-- Write policies: user can write to their own folder (path keyed on
-- their app_users.id), OR an admin can write anywhere in the bucket.
-- storage.foldername(name) returns the path segments as an array;
-- [1] is the first segment (the per-user folder).

drop policy if exists "app-user-photos self or admin insert" on storage.objects;
create policy "app-user-photos self or admin insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'app-user-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_app_user_id()::text
    )
  );

drop policy if exists "app-user-photos self or admin update" on storage.objects;
create policy "app-user-photos self or admin update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'app-user-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_app_user_id()::text
    )
  )
  with check (
    bucket_id = 'app-user-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_app_user_id()::text
    )
  );

drop policy if exists "app-user-photos self or admin delete" on storage.objects;
create policy "app-user-photos self or admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'app-user-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_app_user_id()::text
    )
  );
