-- Phone number + directory opt-out on app_users.
--
-- Both are self-editable. The column-lock trigger
-- (enforce_app_users_self_update_columns) uses an explicit DENY list,
-- so adding columns that don't appear in the list permits non-admins
-- to update them on their own row by default — no trigger change
-- required here. If we ever want to lock these down (e.g. only admins
-- can set phone) we'd add them to the trigger in a follow-up.
--
-- in_directory defaults true (opt-out, not opt-in) so existing rows
-- show up in the directory until a user explicitly hides themselves.

alter table public.app_users
  add column if not exists phone text
    check (phone is null or char_length(phone) <= 30);

alter table public.app_users
  add column if not exists in_directory boolean not null default true;

-- ─────────────────────────────────────────────────────────────────────
-- Employee Directory read function.
--
-- Returns the directory-safe slice of app_users for any signed-in user.
-- This is the ONLY path through which non-admins can see other users'
-- info — RLS on app_users itself stays restrictive (admin or self),
-- and this function bypasses it via SECURITY DEFINER while only
-- exposing the safe columns (name, title, role, station/shift, email,
-- phone). Sensitive columns — fuel_number, date_of_birth,
-- featured_quick_link_ids, auth_user_id — are deliberately omitted so
-- there's no SELECT path to them for non-admins.
--
-- Filters: active = true AND in_directory = true. Users who opt out
-- via the profile modal disappear from the directory but stay visible
-- to admins via /admin/employees.
-- ─────────────────────────────────────────────────────────────────────

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
  phone text
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
    phone
  from public.app_users
  where active = true and in_directory = true
  order by full_name asc;
$$;

grant execute on function public.get_employee_directory() to authenticated;
