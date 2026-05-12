-- ─────────────────────────────────────────────────────────────────────
-- 0017_app_users_title
--
-- Add a free-text `title` column to `app_users` for the employee's
-- credential / job title — e.g. "Paramedic", "EMT", "Operations
-- Director", "Medical Director". Distinct from `role`, which is the
-- permissions enum (crew / supervisor / admin) and stays as the
-- access-control hook.
--
-- The birthday banner on the dashboard reads `title` + `station`
-- instead of the permissions role + shift so the celebration reads
-- as "Justin St. John, Paramedic · S202" rather than the more
-- internal "Admin · C Shift".
--
-- Title is admin-only editable — same pattern as fuel_number and
-- role. Updating someone's credential is an HR action; we don't
-- want crew self-promoting from EMT to Paramedic in the UI.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS title text;

-- Update the self-update column-lock trigger so non-admins can't
-- change their own title.
CREATE OR REPLACE FUNCTION public.enforce_app_users_self_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'app_users.email is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.first_name IS DISTINCT FROM OLD.first_name THEN
    RAISE EXCEPTION 'app_users.first_name is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_name IS DISTINCT FROM OLD.last_name THEN
    RAISE EXCEPTION 'app_users.last_name is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    RAISE EXCEPTION 'app_users.full_name is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'app_users.role is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    RAISE EXCEPTION 'app_users.title is admin-only' USING ERRCODE = '42501';
  END IF;
  -- shift: permitted on self-update (set in 0014).
  IF NEW.fuel_number IS DISTINCT FROM OLD.fuel_number THEN
    RAISE EXCEPTION 'app_users.fuel_number is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    RAISE EXCEPTION 'app_users.date_of_birth is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    RAISE EXCEPTION 'app_users.active is admin-only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
