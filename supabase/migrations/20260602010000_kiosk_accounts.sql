-- ─────────────────────────────────────────────────────────────────────
-- 0051_kiosk_accounts
--
-- Station rigs and station houses share a mailbox the crew on duty
-- signs into for charts and email: `medic242@wallercountyems.com`,
-- `s202@…`, etc. Those mailboxes started auto-provisioning intranet
-- accounts via `handle_new_auth_user`, polluting the directory and the
-- birthday/spotlight feeds with "users" that aren't people.
--
-- Solution: tag those rows with `account_type='kiosk'`. Kiosks get:
--   • Read access to most pages (so a medic on shift can still look up
--     door codes / hospitals / training from the rig laptop).
--   • No directory entry, no birthday card, no spotlight.
--   • No ability to react / comment (RLS rejects the insert).
--   • No profile completion nudge, no push notifications.
--   • No required-training assignment (they aren't employees).
--
-- Auto-detection: emails matching ^medic\d+@ or ^s\d+@ are flagged on
-- first sign-in. Admin can also flip the bit manually via /admin/employees.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Column + check ──────────────────────────────────────────────────
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'person'
  CHECK (account_type IN ('person', 'kiosk'));

CREATE INDEX IF NOT EXISTS app_users_account_type_idx
  ON public.app_users (account_type);

-- 2) Backfill the existing rig row(s) ────────────────────────────────
UPDATE public.app_users
   SET account_type = 'kiosk'
 WHERE lower(email) ~ '^(medic\d+|s\d+)@wallercountyems\.com$'
   AND account_type = 'person';

-- 3) Lock account_type down to admin-only writes ─────────────────────
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
  -- shift: self-editable
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
  IF NEW.account_type IS DISTINCT FROM OLD.account_type THEN
    RAISE EXCEPTION 'app_users.account_type is admin-only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Auto-tag kiosks on sign-in ──────────────────────────────────────
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
  v_account_type text;
BEGIN
  -- Rig / station mailboxes get auto-tagged as kiosks.
  IF lower(NEW.email) ~ '^(medic\d+|s\d+)@wallercountyems\.com$' THEN
    v_account_type := 'kiosk';
  ELSE
    v_account_type := 'person';
  END IF;

  /* Look for a pre-seeded or already-claimed row by email. */
  SELECT id, auth_user_id INTO v_existing_id, v_existing_auth_id
  FROM public.app_users
  WHERE lower(email) = lower(NEW.email)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    /* Pre-seeded row exists. Claim it if it isn't already claimed.
       Also retag the account_type so old rows pick up the kiosk flag
       on their first re-sign-in. */
    IF v_existing_auth_id IS NULL THEN
      UPDATE public.app_users
      SET auth_user_id = NEW.id,
          account_type = v_account_type
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
    (id, auth_user_id, email, first_name, last_name, full_name, role, account_type)
  VALUES
    (gen_random_uuid(), NEW.id, NEW.email, v_first_name, v_last_name,
     v_full_name, v_role, v_account_type)
  ON CONFLICT (email) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    account_type = EXCLUDED.account_type;

  RETURN NEW;
END;
$$;

-- 5) is_kiosk_user() helper ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_kiosk_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid()
      AND account_type = 'kiosk'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_kiosk_user() TO authenticated;

-- 6) Tighten engagement INSERT policies — kiosks can't react/comment.
DROP POLICY IF EXISTS "birthday_reactions self insert" ON public.birthday_reactions;
CREATE POLICY "birthday_reactions self insert"
  ON public.birthday_reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
  );

DROP POLICY IF EXISTS "birthday_comments self insert" ON public.birthday_comments;
CREATE POLICY "birthday_comments self insert"
  ON public.birthday_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
  );

DROP POLICY IF EXISTS "photo_reactions self insert" ON public.photo_reactions;
CREATE POLICY "photo_reactions self insert"
  ON public.photo_reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
  );

DROP POLICY IF EXISTS "photo_comments self insert" ON public.photo_comments;
CREATE POLICY "photo_comments self insert"
  ON public.photo_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
  );
