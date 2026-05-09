-- ─────────────────────────────────────────────────────────────────────
-- 0001_app_users — first migration.
--
-- Replaces the email-bootstrap shortcut in `src/stores/auth.ts` with a
-- real `app_users` row keyed to `auth.users(id)`. Once this lands every
-- subsequent table can FK to `app_users(id)` and RLS policies can lean
-- on the `is_admin()` helper instead of duplicating subqueries.
--
-- Behavior:
--   • New auth.users insert → trigger creates an `app_users` row with
--     name fields parsed from the Microsoft ID-token claims.
--   • Bootstrap admin: rows whose email matches the WCEMS admin email
--     get `role = 'admin'` on creation. Everyone else starts as 'crew'
--     until an admin promotes them via the (forthcoming) Manage
--     Employees page.
--   • RLS: authenticated users can read every row (the app needs the
--     directory). Users can update their own row. Admins can do
--     anything. INSERTs are reserved for the trigger (SECURITY DEFINER)
--     and for admins.
-- ─────────────────────────────────────────────────────────────────────

-- Enums ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('crew', 'supervisor', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.shift_letter AS ENUM ('A', 'B', 'C');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_users (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text NOT NULL UNIQUE,
  first_name     text NOT NULL DEFAULT '',
  last_name      text NOT NULL DEFAULT '',
  full_name      text NOT NULL DEFAULT '',
  role           public.app_role NOT NULL DEFAULT 'crew',
  shift          public.shift_letter,
  station        text,
  fuel_number    text,
  date_of_birth  date,
  show_birthday  boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_users_email_lower_idx
  ON public.app_users (lower(email));

-- updated_at trigger ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_users_touch_updated_at ON public.app_users;
CREATE TRIGGER app_users_touch_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- is_admin helper ────────────────────────────────────────────────────
-- SECURITY DEFINER bypasses RLS so admin-checking policies don't recurse
-- back into themselves. STABLE marks the function safe to call inside
-- planning (Supabase optimizes per-row evaluation).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE id = auth.uid() AND role = 'admin' AND active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Auto-create app_users row on auth.users insert ─────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_full_name text;
  v_first_name text;
  v_last_name text;
  v_role public.app_role;
BEGIN
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

  INSERT INTO public.app_users (id, email, first_name, last_name, full_name, role)
  VALUES (NEW.id, NEW.email, v_first_name, v_last_name, v_full_name, v_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Backfill auth.users rows that exist before the trigger was installed.
DO $$
DECLARE
  u RECORD;
  v_full_name text;
  v_first_name text;
  v_last_name text;
  v_role public.app_role;
BEGIN
  FOR u IN SELECT * FROM auth.users LOOP
    IF EXISTS (SELECT 1 FROM public.app_users WHERE id = u.id) THEN
      CONTINUE;
    END IF;
    v_full_name := COALESCE(
      NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
      NULLIF(trim(u.raw_user_meta_data->>'name'), ''),
      split_part(u.email, '@', 1)
    );
    v_first_name := split_part(v_full_name, ' ', 1);
    IF position(' ' IN v_full_name) > 0 THEN
      v_last_name := substring(v_full_name FROM position(' ' IN v_full_name) + 1);
    ELSE
      v_last_name := '';
    END IF;
    IF lower(u.email) = 'justin.stjohn@wallercountyems.com' THEN
      v_role := 'admin'::public.app_role;
    ELSE
      v_role := 'crew'::public.app_role;
    END IF;
    INSERT INTO public.app_users (id, email, first_name, last_name, full_name, role)
    VALUES (u.id, u.email, v_first_name, v_last_name, v_full_name, v_role);
  END LOOP;
END$$;

-- Justin's seed values — match the dev stub so admin previewing in
-- production looks identical to dev.
UPDATE public.app_users
SET
  shift = 'C',
  station = 'S202 / M271',
  fuel_number = '30988',
  date_of_birth = '1991-04-03',
  show_birthday = true
WHERE lower(email) = 'justin.stjohn@wallercountyems.com';

-- RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_users select for authenticated" ON public.app_users;
CREATE POLICY "app_users select for authenticated"
  ON public.app_users FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "app_users self update" ON public.app_users;
CREATE POLICY "app_users self update"
  ON public.app_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "app_users admin all" ON public.app_users;
CREATE POLICY "app_users admin all"
  ON public.app_users FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
-- INSERT is intentionally not exposed to non-admins; the trigger uses
-- SECURITY DEFINER and so bypasses RLS. DELETE is admin-only via the
-- "admin all" policy.
