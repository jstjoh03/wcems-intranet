-- ─────────────────────────────────────────────────────────────────────
-- 0048_employment_type_and_overrides
--
-- Two related improvements:
--
--  1. Proper Full-Time vs Part-Time classification.
--     Today, the only way to mark someone PT is to set station='Part-Time'
--     (legacy from FLOAT/PRN). That's leaky — a PT employee can't ALSO
--     have a real station assigned, and "is this person PT" isn't easy
--     to query. Promote it to its own column with a CHECK enum, migrate
--     the legacy data, and add it to the column-lock trigger so only
--     admins can flip the classification.
--
--  2. Per-user required-training overrides.
--     Audience filters (role + shift + the new employment_type) cover
--     90% of cases, but admins need to be able to explicitly include or
--     exclude a single person from a module (e.g. "this PT person DOES
--     need it; this FT supervisor doesn't"). One row per
--     (training, user) override; `included` says true=force-in,
--     false=force-out.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1) employment_type column ──────────────────────────────────────
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'full_time'
  CHECK (employment_type IN ('full_time', 'part_time'));

CREATE INDEX IF NOT EXISTS app_users_employment_type_idx
  ON public.app_users (employment_type);

-- Backfill from the legacy station='Part-Time' hack, then clear those
-- stations so PT folks aren't double-tagged.
UPDATE public.app_users
   SET employment_type = 'part_time'
 WHERE station = 'Part-Time' AND employment_type = 'full_time';

UPDATE public.app_users
   SET station = NULL
 WHERE station = 'Part-Time';

-- Add to the column-lock trigger denylist (admin-only writes).
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
  IF NEW.employment_type IS DISTINCT FROM OLD.employment_type THEN
    RAISE EXCEPTION 'app_users.employment_type is admin-only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2) audience_employment_types on required_trainings ─────────────
ALTER TABLE public.required_trainings
  ADD COLUMN IF NOT EXISTS audience_employment_types text[] NOT NULL DEFAULT '{}'::text[];

-- ── 3) Per-user overrides ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.required_training_user_overrides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  required_training_id  uuid NOT NULL REFERENCES public.required_trainings(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  /* true  = force-include this user even if they don't match the
     audience filter. false = force-exclude this user even if they do
     match. NULL/absent = no override (audience filter decides). */
  included              boolean NOT NULL,
  created_by            uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (required_training_id, user_id)
);

CREATE INDEX IF NOT EXISTS rt_overrides_training_idx
  ON public.required_training_user_overrides (required_training_id);
CREATE INDEX IF NOT EXISTS rt_overrides_user_idx
  ON public.required_training_user_overrides (user_id);

DROP TRIGGER IF EXISTS rt_overrides_touch_updated_at
  ON public.required_training_user_overrides;
CREATE TRIGGER rt_overrides_touch_updated_at
  BEFORE UPDATE ON public.required_training_user_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.required_training_user_overrides ENABLE ROW LEVEL SECURITY;

/* Crew can see their own override row (so the audience-filter logic
   works on the client). Admins see all and write all. */
DROP POLICY IF EXISTS "rt_overrides self or admin select"
  ON public.required_training_user_overrides;
CREATE POLICY "rt_overrides self or admin select"
  ON public.required_training_user_overrides FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rt_overrides admin all"
  ON public.required_training_user_overrides;
CREATE POLICY "rt_overrides admin all"
  ON public.required_training_user_overrides FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.required_training_user_overrides TO authenticated;
GRANT ALL ON public.required_training_user_overrides TO service_role;
