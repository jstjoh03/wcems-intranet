-- ─────────────────────────────────────────────────────────────────────
-- social_media_release
--
-- Electronic Social Media Photo & Video Release form. Replaces the
-- paper "New Employee Authorization" form: each employee signs once
-- in the portal (yes/no consent + optional restrictions + drawn
-- signature). One row per person — changing your answer updates the
-- row rather than stacking versions, since the release is a standing
-- authorization the employee may revoke.
--
-- Admin-marked rows cover paper forms already on file (signature
-- stays NULL; the PDF renders "paper form on file" instead).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_media_releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE CASCADE,
  authorized      boolean NOT NULL,
  restrictions    text NOT NULL DEFAULT '',
  signature_data  text,
  signed_method   text NOT NULL DEFAULT 'self'
                  CHECK (signed_method IN ('self','admin_marked')),
  marked_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  marked_note     text,
  signed_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_media_releases_user_idx
  ON public.social_media_releases (user_id);

DROP TRIGGER IF EXISTS social_media_releases_touch_updated_at
  ON public.social_media_releases;
CREATE TRIGGER social_media_releases_touch_updated_at
  BEFORE UPDATE ON public.social_media_releases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.social_media_releases ENABLE ROW LEVEL SECURITY;

-- Releases contain signatures and consent decisions: visible to the
-- signer and admins only (the social media manager is an admin).
DROP POLICY IF EXISTS "smr self or admin select" ON public.social_media_releases;
CREATE POLICY "smr self or admin select"
  ON public.social_media_releases FOR SELECT
  TO authenticated
  USING (public.is_admin() OR user_id = public.current_app_user_id());

DROP POLICY IF EXISTS "smr self insert" ON public.social_media_releases;
CREATE POLICY "smr self insert"
  ON public.social_media_releases FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.current_app_user_id()
    AND NOT public.is_kiosk_user()
    AND signed_method = 'self'
  );

-- Employees may revise or revoke their own standing authorization.
DROP POLICY IF EXISTS "smr self update" ON public.social_media_releases;
CREATE POLICY "smr self update"
  ON public.social_media_releases FOR UPDATE
  TO authenticated
  USING (user_id = public.current_app_user_id() AND NOT public.is_kiosk_user())
  WITH CHECK (
    user_id = public.current_app_user_id()
    AND NOT public.is_kiosk_user()
    AND signed_method = 'self'
  );

DROP POLICY IF EXISTS "smr admin all" ON public.social_media_releases;
CREATE POLICY "smr admin all"
  ON public.social_media_releases FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_media_releases TO authenticated;
GRANT ALL ON public.social_media_releases TO service_role;
