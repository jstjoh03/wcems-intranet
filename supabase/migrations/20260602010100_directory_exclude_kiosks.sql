-- ─────────────────────────────────────────────────────────────────────
-- 0052_directory_exclude_kiosks
--
-- Hide kiosk accounts (rig / station mailboxes) from the Employee
-- Directory. Server-side filter so it doesn't matter how the client
-- queries — kiosk rows never get returned.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_employee_directory()
RETURNS TABLE (
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
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
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
  FROM public.app_users
  WHERE active = true
    AND in_directory = true
    AND account_type = 'person'
  ORDER BY full_name ASC;
$$;
