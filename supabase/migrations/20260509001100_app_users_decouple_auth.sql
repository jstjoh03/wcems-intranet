-- ─────────────────────────────────────────────────────────────────────
-- 0012_app_users_decouple_auth
--
-- Decouples `app_users.id` from `auth.users(id)` so admins can pre-seed
-- employee rows before those employees sign in for the first time. Once
-- an employee signs in, the trigger claims their pre-seeded row by
-- email and binds the auth provider id to it.
--
-- Schema:
--   • Adds `auth_user_id uuid` (FK to auth.users(id), nullable, unique).
--   • Backfills `auth_user_id = id` for every existing row, then drops
--     the FK on `app_users.id`. The `id` column stays as a uuid PK but
--     no longer requires a corresponding auth.users row, so admins can
--     INSERT rows with `auth_user_id IS NULL`.
--   • Adds `current_app_user_id()` — SECURITY DEFINER helper that
--     resolves the signed-in user's `app_users.id` from `auth.uid()`.
--     Used by RLS on tables that FK to app_users(id) (today
--     birthday_reactions and user_link_preferences).
--   • Updates `is_admin()` to look up the role via auth_user_id rather
--     than the now-decoupled id.
--
-- Triggers updated:
--   • handle_new_auth_user: claim-by-email path. If a pre-seeded row
--     exists for the new auth user's email, set its auth_user_id;
--     otherwise INSERT a fresh row (the original behavior).
--   • enforce_app_users_self_update_columns: WHEN clause now matches
--     auth.uid() against OLD.auth_user_id rather than OLD.id.
--   • audit_station_code_change / audit_hospital_code_change /
--     stamp_station_door_code_change / stamp_hospital_door_code_change:
--     resolve the signed-in user's app_users row via auth_user_id.
--
-- RLS updated:
--   • app_users self-update USING/WITH CHECK swap from id to auth_user_id.
--   • birthday_reactions self insert/delete use current_app_user_id().
--   • user_link_preferences self all uses current_app_user_id().
-- ─────────────────────────────────────────────────────────────────────

-- 1) Add auth_user_id column ────────────────────────────────────────
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- Backfill: for existing rows where id matches an auth.users row, copy.
UPDATE public.app_users a
SET auth_user_id = a.id
WHERE auth_user_id IS NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.id);

-- 2) Drop the old FK from app_users.id to auth.users(id) ────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_users_id_fkey'
      AND conrelid = 'public.app_users'::regclass
  ) THEN
    ALTER TABLE public.app_users DROP CONSTRAINT app_users_id_fkey;
  END IF;
END$$;

-- 3) Add the new FK + uniqueness on auth_user_id ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_users_auth_user_id_fkey'
      AND conrelid = 'public.app_users'::regclass
  ) THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_users_auth_user_id_key'
      AND conrelid = 'public.app_users'::regclass
  ) THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_auth_user_id_key UNIQUE (auth_user_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS app_users_auth_user_id_idx
  ON public.app_users (auth_user_id);

-- 4) current_app_user_id() helper ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.app_users WHERE auth_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

-- 5) is_admin() rewritten for auth_user_id ──────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
      AND active = true
  );
$$;

-- 6) handle_new_auth_user — claim-by-email or insert fresh ──────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing_id uuid;
  v_existing_auth_id uuid;
  v_full_name text;
  v_first_name text;
  v_last_name text;
  v_role public.app_role;
BEGIN
  /* Look for a pre-seeded or already-claimed row by email. */
  SELECT id, auth_user_id INTO v_existing_id, v_existing_auth_id
  FROM public.app_users
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    /* Pre-seeded row exists. Claim it if it isn't already claimed. */
    IF v_existing_auth_id IS NULL THEN
      UPDATE public.app_users
      SET auth_user_id = NEW.id
      WHERE id = v_existing_id;
    END IF;
    RETURN NEW;
  END IF;

  /* No pre-seed: insert a fresh row with derived defaults. */
  v_full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1)
  );
  v_first_name := split_part(v_full_name, ' ', 1);
  IF position(' ' IN v_full_name) > 0 THEN
    v_last_name := substring(v_full_name FROM position(' ' IN v_full_name) + 1);
  ELSE
    v_last_name := '';
  END IF;

  IF lower(NEW.email) = 'justin.stjohn@wallercountyems.com' THEN
    v_role := 'admin'::public.app_role;
  ELSE
    v_role := 'crew'::public.app_role;
  END IF;

  INSERT INTO public.app_users
    (id, auth_user_id, email, first_name, last_name, full_name, role)
  VALUES
    (gen_random_uuid(), NEW.id, NEW.email, v_first_name, v_last_name,
     v_full_name, v_role)
  ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id;

  RETURN NEW;
END;
$$;

-- 7) Column-lock trigger WHEN clause ────────────────────────────────
DROP TRIGGER IF EXISTS app_users_enforce_self_update_columns ON public.app_users;
CREATE TRIGGER app_users_enforce_self_update_columns
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW
  WHEN (auth.uid() = OLD.auth_user_id)
  EXECUTE FUNCTION public.enforce_app_users_self_update_columns();

-- 8) Audit + stamp triggers — resolve via auth_user_id ──────────────
CREATE OR REPLACE FUNCTION public.stamp_station_door_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
BEGIN
  IF NEW.door_code IS DISTINCT FROM OLD.door_code THEN
    SELECT full_name INTO v_user_name
    FROM public.app_users
    WHERE auth_user_id = auth.uid();
    NEW.door_code_updated_at := now();
    NEW.door_code_updated_by := COALESCE(v_user_name, 'Unknown');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_station_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_user_id uuid;
BEGIN
  IF NEW.door_code IS DISTINCT FROM OLD.door_code THEN
    SELECT id, full_name INTO v_user_id, v_user_name
    FROM public.app_users
    WHERE auth_user_id = auth.uid();

    INSERT INTO public.code_edit_history
      (entity_type, entity_id, code_field, old_value, new_value,
       changed_by, changed_by_user_id)
    VALUES
      ('station', NEW.id, 'door',
       COALESCE(OLD.door_code, ''), COALESCE(NEW.door_code, ''),
       COALESCE(v_user_name, 'Unknown'), v_user_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_hospital_door_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
BEGIN
  IF NEW.er_door_code IS DISTINCT FROM OLD.er_door_code
     OR NEW.ems_room_code IS DISTINCT FROM OLD.ems_room_code THEN
    SELECT full_name INTO v_user_name
    FROM public.app_users
    WHERE auth_user_id = auth.uid();
    NEW.door_code_updated_at := now();
    NEW.door_code_updated_by := COALESCE(v_user_name, 'Unknown');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_hospital_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_user_id uuid;
BEGIN
  SELECT id, full_name INTO v_user_id, v_user_name
  FROM public.app_users
  WHERE auth_user_id = auth.uid();

  IF NEW.er_door_code IS DISTINCT FROM OLD.er_door_code THEN
    INSERT INTO public.code_edit_history
      (entity_type, entity_id, code_field, old_value, new_value,
       changed_by, changed_by_user_id)
    VALUES
      ('hospital', NEW.id, 'er',
       COALESCE(OLD.er_door_code, ''), COALESCE(NEW.er_door_code, ''),
       COALESCE(v_user_name, 'Unknown'), v_user_id);
  END IF;

  IF NEW.ems_room_code IS DISTINCT FROM OLD.ems_room_code THEN
    INSERT INTO public.code_edit_history
      (entity_type, entity_id, code_field, old_value, new_value,
       changed_by, changed_by_user_id)
    VALUES
      ('hospital', NEW.id, 'ems_room',
       COALESCE(OLD.ems_room_code, ''), COALESCE(NEW.ems_room_code, ''),
       COALESCE(v_user_name, 'Unknown'), v_user_id);
  END IF;

  RETURN NEW;
END;
$$;

-- 9) RLS policy updates ─────────────────────────────────────────────
DROP POLICY IF EXISTS "app_users self update" ON public.app_users;
CREATE POLICY "app_users self update"
  ON public.app_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "birthday_reactions self insert" ON public.birthday_reactions;
CREATE POLICY "birthday_reactions self insert"
  ON public.birthday_reactions FOR INSERT
  TO authenticated WITH CHECK (public.current_app_user_id() = user_id);

DROP POLICY IF EXISTS "birthday_reactions self delete" ON public.birthday_reactions;
CREATE POLICY "birthday_reactions self delete"
  ON public.birthday_reactions FOR DELETE
  TO authenticated USING (public.current_app_user_id() = user_id);

DROP POLICY IF EXISTS "user_link_preferences self all" ON public.user_link_preferences;
CREATE POLICY "user_link_preferences self all"
  ON public.user_link_preferences FOR ALL
  TO authenticated
  USING (public.current_app_user_id() = user_id)
  WITH CHECK (public.current_app_user_id() = user_id);
