-- ─────────────────────────────────────────────────────────────────────
-- 0050_restore_self_edit_shift
--
-- Migration 0048 (employment_type_and_overrides) rewrote the column-lock
-- trigger from scratch to add `employment_type` to the admin-only list,
-- but in doing so it RESTORED the `shift` block that 0014 had
-- intentionally removed. End-user symptom: crew open UserProfileModal,
-- change their shift, hit Save, and get
-- "app_users.shift is admin-only".
--
-- Reinstate the 0014 behavior: shift is self-editable (closed A/B/C
-- list, no garbage-value risk), employment_type stays admin-only.
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
  -- shift: self-editable (intentionally NOT blocked).
  IF NEW.fuel_number IS DISTINCT FROM OLD.fuel_number THEN
    RAISE EXCEPTION 'app_users.fuel_number is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    RAISE EXCEPTION 'app_users.date_of_birth is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    RAISE EXCEPTION 'app_users.active is admin-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.employment_type IS DISTINCT FROM OLD.employment_type THEN
    RAISE EXCEPTION 'app_users.employment_type is admin-only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
