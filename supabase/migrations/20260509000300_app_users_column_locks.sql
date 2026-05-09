-- ─────────────────────────────────────────────────────────────────────
-- 0004_app_users_column_locks
--
-- The "app_users self update" RLS policy permits any column change as
-- long as the caller is updating their own row. That gates WHICH ROWS
-- can be touched, not WHICH COLUMNS. Without further enforcement, a
-- crew member could PATCH their own row to set role='admin' and gain
-- access to every privileged route.
--
-- This trigger runs BEFORE UPDATE on self-updates and rejects any
-- change to a privileged column. Permitted self-edits today:
--   • station       — users move between buildings
--   • show_birthday — opt-out preference
-- Everything else (role, shift, fuel #, DOB, name fields, email,
-- active) is admin-only. Admins bypass the trigger via is_admin().
-- ─────────────────────────────────────────────────────────────────────

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
  IF NEW.shift IS DISTINCT FROM OLD.shift THEN
    RAISE EXCEPTION 'app_users.shift is admin-only' USING ERRCODE = '42501';
  END IF;
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

DROP TRIGGER IF EXISTS app_users_enforce_self_update_columns ON public.app_users;
CREATE TRIGGER app_users_enforce_self_update_columns
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW
  WHEN (auth.uid() = OLD.id)
  EXECUTE FUNCTION public.enforce_app_users_self_update_columns();
