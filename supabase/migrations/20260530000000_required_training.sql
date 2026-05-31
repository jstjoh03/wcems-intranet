-- ─────────────────────────────────────────────────────────────────────
-- 0046_required_training
--
-- Compliance training: admin posts a video that crew MUST watch and
-- attest to (signature + auto-generated PDF certificate). Mirrors the
-- Wix protocol-training flow Justin shared but DB-backed and
-- everybody-on-one-platform.
--
-- Two tables:
--   • required_trainings        — the module (one row per training).
--   • required_training_completions — per-user attestation record.
--     "Started" rows are inserted on first play; the same row is
--     flipped to attestation_signed=true on submit.
--
-- Audience: empty audience_roles/audience_shifts = "all active crew".
-- Non-empty arrays narrow it (e.g., only A-shift supervisors).
--
-- Quiz support is reserved (jsonb column + quiz_score on completions)
-- so v1.1 can wire a quiz UI without another migration. v1 ignores it.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1) required_trainings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.required_trainings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                  text NOT NULL,
  description            text NOT NULL DEFAULT '',
  /* Video source — admin picks per module. */
  video_source           text NOT NULL CHECK (video_source IN ('youtube', 'cloudflare_stream', 'direct', 'sharepoint')),
  video_ref              text NOT NULL,
  /* Used by the anti-skip enforcement so we know when "complete"
     fires for direct/cloudflare videos. Optional for youtube (IFrame
     API reports it). */
  duration_seconds       integer,
  /* Compliance deadline. NULL = ongoing, no deadline. */
  required_by            date,
  /* Empty arrays = open to everyone. Non-empty narrows. */
  audience_roles         text[] NOT NULL DEFAULT '{}'::text[],
  audience_shifts        text[] NOT NULL DEFAULT '{}'::text[],
  /* Bullet list rendered above the signature pad. Stored as raw text
     so admins can customize per module. Defaults provided in app. */
  attestation_statement  text NOT NULL DEFAULT '',
  /* Reserved for v1.1: { questions: [{ q, choices[], answer_index }], pass_threshold } */
  quiz                   jsonb,
  active                 boolean NOT NULL DEFAULT true,
  created_by             uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS required_trainings_active_idx
  ON public.required_trainings (active, created_at DESC);

DROP TRIGGER IF EXISTS required_trainings_touch_updated_at
  ON public.required_trainings;
CREATE TRIGGER required_trainings_touch_updated_at
  BEFORE UPDATE ON public.required_trainings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.required_trainings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "required_trainings select for authenticated"
  ON public.required_trainings;
CREATE POLICY "required_trainings select for authenticated"
  ON public.required_trainings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "required_trainings admin all"
  ON public.required_trainings;
CREATE POLICY "required_trainings admin all"
  ON public.required_trainings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.required_trainings TO authenticated;
GRANT ALL ON public.required_trainings TO service_role;

-- ── 2) required_training_completions ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.required_training_completions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  required_training_id     uuid NOT NULL REFERENCES public.required_trainings(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  started_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  /* Data URL of the signature canvas. NULL when admin-marked. */
  signature_data           text,
  /* How the attestation happened. 'self' = crew signed; 'admin_marked'
     = admin attested on the crew member's behalf (Teams sessions,
     in-person sign-off, etc.). */
  signed_method            text NOT NULL DEFAULT 'self'
    CHECK (signed_method IN ('self', 'admin_marked')),
  marked_by                uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  marked_note              text,
  /* Reserved for v1.1 quiz support. */
  quiz_score               numeric(5,2),
  quiz_answers             jsonb,
  attestation_signed       boolean NOT NULL DEFAULT false,
  certificate_storage_path text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (required_training_id, user_id)
);

CREATE INDEX IF NOT EXISTS rtc_user_idx
  ON public.required_training_completions (user_id);
CREATE INDEX IF NOT EXISTS rtc_training_idx
  ON public.required_training_completions (required_training_id);
CREATE INDEX IF NOT EXISTS rtc_completed_at_idx
  ON public.required_training_completions (completed_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS rtc_touch_updated_at
  ON public.required_training_completions;
CREATE TRIGGER rtc_touch_updated_at
  BEFORE UPDATE ON public.required_training_completions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.required_training_completions ENABLE ROW LEVEL SECURITY;

/* Crew see their own; admins see everything (for the roster view). */
DROP POLICY IF EXISTS "rtc self or admin select"
  ON public.required_training_completions;
CREATE POLICY "rtc self or admin select"
  ON public.required_training_completions FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

/* Crew can only insert/update their own row; admins anywhere. */
DROP POLICY IF EXISTS "rtc self or admin write"
  ON public.required_training_completions;
CREATE POLICY "rtc self or admin write"
  ON public.required_training_completions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rtc self or admin update"
  ON public.required_training_completions;
CREATE POLICY "rtc self or admin update"
  ON public.required_training_completions FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rtc admin delete"
  ON public.required_training_completions;
CREATE POLICY "rtc admin delete"
  ON public.required_training_completions FOR DELETE
  TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.required_training_completions TO authenticated;
GRANT ALL ON public.required_training_completions TO service_role;

-- ── 3) Helper RPC: admin manual mark-complete ──────────────────────
-- One call inserts (or flips an existing row) to attestation_signed
-- with signed_method='admin_marked'. SECURITY DEFINER so we resolve
-- marked_by from auth.uid() and skip RLS gymnastics on insert.
CREATE OR REPLACE FUNCTION public.admin_mark_required_training_complete(
  training_id uuid,
  target_user_id uuid,
  note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marker_id uuid;
  v_row_id    uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT id INTO v_marker_id
    FROM public.app_users
    WHERE auth_user_id = auth.uid();

  INSERT INTO public.required_training_completions
    (required_training_id, user_id, completed_at, signed_method, marked_by, marked_note,
     attestation_signed, signature_data)
  VALUES
    (training_id, target_user_id, now(), 'admin_marked', v_marker_id, note,
     true, NULL)
  ON CONFLICT (required_training_id, user_id) DO UPDATE
    SET completed_at       = EXCLUDED.completed_at,
        signed_method      = 'admin_marked',
        marked_by          = v_marker_id,
        marked_note        = EXCLUDED.marked_note,
        attestation_signed = true,
        updated_at         = now()
  RETURNING id INTO v_row_id;

  RETURN v_row_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_mark_required_training_complete(uuid, uuid, text) TO authenticated;
