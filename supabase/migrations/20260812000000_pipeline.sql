-- ─────────────────────────────────────────────────────────────────────
-- 20260812000000_pipeline
--
-- Clinical Development pipeline: live FTEP credentialing tracker.
-- Replaces the static pipeline-board.html snapshot with editable
-- records for every roster member (phases, per-transition gates,
-- licenses/compliance, the pending NEOP cohort).
--
-- Three tables:
--   • pipeline_editors       — person-specific edit grant. Clinical
--     data entry is NOT an admin-role right (portal admins aren't all
--     clinical staff); only listed people may write pipeline data.
--   • pipeline_records       — one row per app_user: phase position,
--     track flags (P3/AEMT/PIP/pending), licenses + compliance dates,
--     coverage/blocker notes. cert_level + TX license columns are
--     owned by roster-sync (HR edit-once chain); everything else is
--     portal-owned.
--   • pipeline_gate_progress — per-person per-gate check-offs. Gate
--     DEFINITIONS live in src/constants/pipelineGates.ts (they encode
--     FTEP policy incl. numeric thresholds); this table stores only
--     status/value/who/when per (record, transition, gate_key).
--     Petition-chain signatures are gate rows too (petition_fto …).
--
-- Visibility: supervisors/admins, pipeline editors, and FTOs (own
-- record flagged is_fto) see everything; everyone else sees only
-- their own row. is_fto_viewer() is SECURITY DEFINER so the
-- pipeline_records SELECT policy can consult pipeline_records itself
-- without recursive RLS evaluation.
-- ─────────────────────────────────────────────────────────────────────

-- ── 0) Role helpers ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_supervisor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid()
      AND role IN ('supervisor', 'admin')
      AND active = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_supervisor() TO authenticated;

-- ── 1) pipeline_editors ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_editors (
  user_id    uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_pipeline_editor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pipeline_editors e
    JOIN public.app_users u ON u.id = e.user_id
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_pipeline_editor() TO authenticated;

ALTER TABLE public.pipeline_editors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_editors select for authenticated"
  ON public.pipeline_editors;
CREATE POLICY "pipeline_editors select for authenticated"
  ON public.pipeline_editors FOR SELECT
  TO authenticated USING (true);

/* Admins manage the grant list (avoids editor lockout); editors can
   also add/remove peers. */
DROP POLICY IF EXISTS "pipeline_editors admin or editor all"
  ON public.pipeline_editors;
CREATE POLICY "pipeline_editors admin or editor all"
  ON public.pipeline_editors FOR ALL
  TO authenticated
  USING (public.is_admin() OR public.is_pipeline_editor())
  WITH CHECK (public.is_admin() OR public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_editors TO authenticated;
GRANT ALL ON public.pipeline_editors TO service_role;

-- ── 2) pipeline_records ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE CASCADE,
  /* Two-axis ladder position: cleared = authorized to ride as,
     working = currently progressing toward. */
  cleared_phase          text CHECK (cleared_phase IN ('NEOP','FTR','P1','P2','P3','FinalRelease')),
  working_phase          text CHECK (working_phase IN ('NEOP','FTR','P1','P2','P3','FinalRelease')),
  working_started_at     date,
  working_target_at      date,
  /* Awaiting-clearance cohort ("ghost" rows, e.g. Aug 17 NEOP class). */
  pending                boolean NOT NULL DEFAULT false,
  pip_active             boolean NOT NULL DEFAULT false,
  pip_started_at         date,
  pip_reason             text,
  in_p3_process          boolean NOT NULL DEFAULT false,
  in_aemt_upgrade        boolean NOT NULL DEFAULT false,
  /* Internal credential level driving the badge (P1C, P1, P2, FTO,
     ADV, EMT…). Distinct from ladder position — a released medic is
     level P2 with cleared_phase FinalRelease. */
  level                  text,
  /* Credentialed FTO — grants full-board visibility + badge. */
  is_fto                 boolean NOT NULL DEFAULT false,
  /* Assigned FTO (trainer) for people in a phase. */
  fto_name               text,
  /* Roster-sync-owned (HR edit-once chain) — never hand-edit. */
  cert_level             text,
  tx_license_number      text,
  tx_license_expires_at  date,
  /* Compliance + access dates. */
  tx_jurisprudence_at    date,
  bloodborne_pathogen_at date,
  op_iq_granted_at       date,
  narc_safe_granted_at   date,
  est_p2_ready_at        date,
  coverage_note          text,
  blocker_note           text,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_records_user_idx
  ON public.pipeline_records (user_id);

DROP TRIGGER IF EXISTS pipeline_records_touch_updated_at
  ON public.pipeline_records;
CREATE TRIGGER pipeline_records_touch_updated_at
  BEFORE UPDATE ON public.pipeline_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

/* FTO check for the SELECT policies below. SECURITY DEFINER so the
   policy on pipeline_records can read pipeline_records w/o recursion. */
CREATE OR REPLACE FUNCTION public.is_fto_viewer()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pipeline_records r
    JOIN public.app_users u ON u.id = r.user_id
    WHERE u.auth_user_id = auth.uid()
      AND u.active = true
      AND r.is_fto = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_fto_viewer() TO authenticated;

ALTER TABLE public.pipeline_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_records board or self select"
  ON public.pipeline_records;
CREATE POLICY "pipeline_records board or self select"
  ON public.pipeline_records FOR SELECT
  TO authenticated
  USING (
    public.is_supervisor()
    OR public.is_pipeline_editor()
    OR public.is_fto_viewer()
    OR user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pipeline_records editor all"
  ON public.pipeline_records;
CREATE POLICY "pipeline_records editor all"
  ON public.pipeline_records FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_records TO authenticated;
GRANT ALL ON public.pipeline_records TO service_role;

-- ── 3) pipeline_gate_progress ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_gate_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id    uuid NOT NULL REFERENCES public.pipeline_records(id) ON DELETE CASCADE,
  transition   text NOT NULL CHECK (transition IN ('NEOP','P1C_P1','P1_P2','P2_P3','AEMT')),
  gate_key     text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','na')),
  /* Free-form evidence: "3.7 / 3.5", "8 / 10", petition signer name… */
  value        text,
  completed_at date,
  completed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, transition, gate_key)
);

CREATE INDEX IF NOT EXISTS pipeline_gate_progress_record_idx
  ON public.pipeline_gate_progress (record_id);

DROP TRIGGER IF EXISTS pipeline_gate_progress_touch_updated_at
  ON public.pipeline_gate_progress;
CREATE TRIGGER pipeline_gate_progress_touch_updated_at
  BEFORE UPDATE ON public.pipeline_gate_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.pipeline_gate_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_gate_progress board or self select"
  ON public.pipeline_gate_progress;
CREATE POLICY "pipeline_gate_progress board or self select"
  ON public.pipeline_gate_progress FOR SELECT
  TO authenticated
  USING (
    public.is_supervisor()
    OR public.is_pipeline_editor()
    OR public.is_fto_viewer()
    OR EXISTS (
      SELECT 1 FROM public.pipeline_records r
      WHERE r.id = record_id
        AND r.user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "pipeline_gate_progress editor all"
  ON public.pipeline_gate_progress;
CREATE POLICY "pipeline_gate_progress editor all"
  ON public.pipeline_gate_progress FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_gate_progress TO authenticated;
GRANT ALL ON public.pipeline_gate_progress TO service_role;

-- ── 4) Realtime ────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pipeline_records', 'pipeline_gate_progress']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        t
      );
    END IF;
  END LOOP;
END$$;
