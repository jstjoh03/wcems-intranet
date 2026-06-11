-- ─────────────────────────────────────────────────────────────────────
-- 0053_policies
--
-- Policy acknowledgement system. Parallel to required_trainings but
-- document-centric: crew open a PDF, scroll to the end, sign three
-- attestation checkboxes, and the row goes into
-- policy_acknowledgements. Admins upload PDFs, set audience, get a
-- roster + sign-off export.
--
-- Versioning: when admin uploads a new PDF, `version` increments. The
-- old acknowledgements stay (audit) but their
-- `policy_version_at_signing` no longer matches the current version
-- — crew-side flags them as outstanding again. Old PDFs remain in
-- Storage at `{policy_id}/v{N}.pdf` so we can prove what was signed.
-- ─────────────────────────────────────────────────────────────────────

-- 1) policies ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   text NOT NULL,
  summary                 text NOT NULL DEFAULT '',
  category                text NOT NULL DEFAULT 'general'
                          CHECK (category IN ('clinical','operational','hr','general')),
  /* Current PDF path within the policy-documents storage bucket. The
     convention is `{policy_id}/v{version}.pdf`; admin uploads bump
     `version` and write to a new path so old files stay accessible. */
  document_storage_path   text,
  document_filename       text,
  /* Monotonically increases on every replace-document admin action.
     Crew sees re-prompt when their last acknowledgement was for a
     prior version. */
  version                 integer NOT NULL DEFAULT 1,
  effective_date          date,
  review_cycle            text DEFAULT 'annual'
                          CHECK (review_cycle IN ('annual','biennial','as_needed')),
  /* Same audience filter shape as required_trainings — empty array on
     any axis means "match all on this axis". */
  audience_roles                text[] NOT NULL DEFAULT '{}'::text[],
  audience_shifts               text[] NOT NULL DEFAULT '{}'::text[],
  audience_employment_types     text[] NOT NULL DEFAULT '{}'::text[],
  attestation_statement   text NOT NULL DEFAULT
    'I have read this policy, I understand its contents, and I know where to find it on the intranet.',
  active                  boolean NOT NULL DEFAULT true,
  created_by              uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policies_category_idx ON public.policies (category);
CREATE INDEX IF NOT EXISTS policies_active_idx ON public.policies (active);

DROP TRIGGER IF EXISTS policies_touch_updated_at ON public.policies;
CREATE TRIGGER policies_touch_updated_at
  BEFORE UPDATE ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policies select for authenticated" ON public.policies;
CREATE POLICY "policies select for authenticated"
  ON public.policies FOR SELECT
  TO authenticated USING (active = true OR public.is_admin());

DROP POLICY IF EXISTS "policies admin all" ON public.policies;
CREATE POLICY "policies admin all"
  ON public.policies FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.policies TO authenticated;
GRANT ALL ON public.policies TO service_role;

-- 2) policy_acknowledgements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policy_acknowledgements (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id                     uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  user_id                       uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  /* Which version of the policy was acknowledged. If the policies row
     has incremented past this, the user needs to re-acknowledge. */
  policy_version_at_signing     integer NOT NULL,
  acknowledged_at               timestamptz NOT NULL DEFAULT now(),
  signature_data                text,
  signed_method                 text NOT NULL DEFAULT 'self'
                                CHECK (signed_method IN ('self','admin_marked')),
  marked_by                     uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  marked_note                   text,
  UNIQUE (policy_id, user_id, policy_version_at_signing)
);

CREATE INDEX IF NOT EXISTS policy_ack_policy_idx
  ON public.policy_acknowledgements (policy_id);
CREATE INDEX IF NOT EXISTS policy_ack_user_idx
  ON public.policy_acknowledgements (user_id);

ALTER TABLE public.policy_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_ack select for authenticated" ON public.policy_acknowledgements;
CREATE POLICY "policy_ack select for authenticated"
  ON public.policy_acknowledgements FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "policy_ack self insert" ON public.policy_acknowledgements;
CREATE POLICY "policy_ack self insert"
  ON public.policy_acknowledgements FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
    AND signed_method = 'self'
  );

DROP POLICY IF EXISTS "policy_ack admin all" ON public.policy_acknowledgements;
CREATE POLICY "policy_ack admin all"
  ON public.policy_acknowledgements FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_acknowledgements TO authenticated;
GRANT ALL ON public.policy_acknowledgements TO service_role;

-- 3) Admin-mark RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_policy_acknowledged(
  p_policy_id uuid,
  p_user_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.policy_acknowledgements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_version integer;
  v_row public.policy_acknowledgements;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_admin_id FROM public.app_users WHERE auth_user_id = auth.uid();
  SELECT version INTO v_version FROM public.policies WHERE id = p_policy_id;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'Policy not found';
  END IF;

  INSERT INTO public.policy_acknowledgements
    (policy_id, user_id, policy_version_at_signing, signed_method, marked_by, marked_note)
  VALUES
    (p_policy_id, p_user_id, v_version, 'admin_marked', v_admin_id, p_note)
  ON CONFLICT (policy_id, user_id, policy_version_at_signing) DO UPDATE
    SET signed_method = EXCLUDED.signed_method,
        marked_by = EXCLUDED.marked_by,
        marked_note = EXCLUDED.marked_note,
        acknowledged_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mark_policy_acknowledged(uuid, uuid, text) TO authenticated;

-- 4) Per-user overrides ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policy_user_overrides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id             uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  included              boolean NOT NULL,
  created_by            uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, user_id)
);

CREATE INDEX IF NOT EXISTS policy_overrides_policy_idx
  ON public.policy_user_overrides (policy_id);
CREATE INDEX IF NOT EXISTS policy_overrides_user_idx
  ON public.policy_user_overrides (user_id);

DROP TRIGGER IF EXISTS policy_overrides_touch_updated_at
  ON public.policy_user_overrides;
CREATE TRIGGER policy_overrides_touch_updated_at
  BEFORE UPDATE ON public.policy_user_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.policy_user_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_overrides self or admin select"
  ON public.policy_user_overrides;
CREATE POLICY "policy_overrides self or admin select"
  ON public.policy_user_overrides FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR user_id = public.current_app_user_id()
  );

DROP POLICY IF EXISTS "policy_overrides admin all"
  ON public.policy_user_overrides;
CREATE POLICY "policy_overrides admin all"
  ON public.policy_user_overrides FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_user_overrides TO authenticated;
GRANT ALL ON public.policy_user_overrides TO service_role;

-- 5) Storage bucket for the PDFs ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('policy-documents', 'policy-documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "policy-documents public read" ON storage.objects;
CREATE POLICY "policy-documents public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'policy-documents');

DROP POLICY IF EXISTS "policy-documents admin write" ON storage.objects;
CREATE POLICY "policy-documents admin write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'policy-documents'
    AND public.is_admin()
  );

DROP POLICY IF EXISTS "policy-documents admin update" ON storage.objects;
CREATE POLICY "policy-documents admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'policy-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'policy-documents' AND public.is_admin());

DROP POLICY IF EXISTS "policy-documents admin delete" ON storage.objects;
CREATE POLICY "policy-documents admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'policy-documents' AND public.is_admin());
