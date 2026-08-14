-- ─────────────────────────────────────────────────────────────────────
-- 20260814000000_pipeline_v2
--
-- Justin's first review round (2026-08-14):
--   • Legacy P1→P2 track: the CURRENT P1s working toward P2 predate
--     the new FTEP program — their gate set is 10 narrative call
--     evals + mega code + protocol test (no DORs/ICRs/oral board).
--     `legacy_track` flags them; Dinh stays on the new program.
--   • OpIQ/NarcSafe become held/not-held flags (`*_access`) — the
--     grant DATE is optional detail. Everyone already credentialed
--     has both; no dates exist for them.
--   • John Cates joins Ashley Dodd on the P3/supervisor ride-up track.
--   • Dr. Buzzard's record removed — his credentials aren't tracked
--     here (roster-sync also stops recreating Doc-category rows).
--   • Compliance bones: `pipeline_requirements` (annual / per-cert-
--     cycle / certification / one-time items: card classes, sex
--     trafficking, annual protocol test…) + per-person completions
--     with optional expiry — the landing zone for the weekly Paycom
--     card report and future LMS imports. TX jurisprudence stays a
--     record column; due-ness is computed against the 4-yr licensure
--     cycle in the app.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1) pipeline_records: new flags ─────────────────────────────────
ALTER TABLE public.pipeline_records
  ADD COLUMN IF NOT EXISTS legacy_track     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS op_iq_access     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS narc_safe_access boolean NOT NULL DEFAULT false;

-- ── 2) gate transitions: allow the legacy set ──────────────────────
ALTER TABLE public.pipeline_gate_progress
  DROP CONSTRAINT IF EXISTS pipeline_gate_progress_transition_check;
ALTER TABLE public.pipeline_gate_progress
  ADD CONSTRAINT pipeline_gate_progress_transition_check
  CHECK (transition IN ('NEOP','P1C_P1','P1_P2','P1_P2_LEGACY','P2_P3','AEMT'));

-- ── 3) Data corrections ────────────────────────────────────────────
UPDATE public.pipeline_records r
SET legacy_track = true
FROM public.app_users u
WHERE u.id = r.user_id
  AND u.full_name IN ('Thomas Kim','Ashley Carothers','Tyler Lowery','Perry Tong');

UPDATE public.pipeline_records r
SET in_p3_process = true
FROM public.app_users u
WHERE u.id = r.user_id AND u.full_name = 'John Cates';

DELETE FROM public.pipeline_records r
USING public.app_users u
WHERE u.id = r.user_id AND u.full_name = 'Aaron Buzzard';

/* Everyone already credentialed holds OpIQ + NarcSafe (no dates
   available); anyone with a grant date obviously holds access too. */
UPDATE public.pipeline_records
SET op_iq_access = true
WHERE cleared_phase = 'FinalRelease' OR op_iq_granted_at IS NOT NULL;
UPDATE public.pipeline_records
SET narc_safe_access = true
WHERE cleared_phase = 'FinalRelease' OR narc_safe_granted_at IS NOT NULL;

/* Whole-roster jurisprudence session ran ~June/July 2026 (some staff
   provided outside certs). 2026-07-01 is the agreed APPROXIMATE
   placeholder — correct individual dates in-app as certs surface.
   Pending cohort excluded (they haven't done it). */
UPDATE public.pipeline_records
SET tx_jurisprudence_at = '2026-07-01'
WHERE tx_jurisprudence_at IS NULL AND pending = false;

-- ── 4) Compliance requirements + completions ───────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_requirements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  /* annual         — due every 365 days from last completion
     per_cert_cycle — once per 4-yr TX licensure cycle (vs license exp)
     certification  — card class w/ explicit expiry on the completion
     one_time       — done once, never again */
  cycle      text NOT NULL CHECK (cycle IN ('annual','per_cert_cycle','certification','one_time')),
  active     boolean NOT NULL DEFAULT true,
  sort       integer NOT NULL DEFAULT 100,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS pipeline_requirements_touch_updated_at
  ON public.pipeline_requirements;
CREATE TRIGGER pipeline_requirements_touch_updated_at
  BEFORE UPDATE ON public.pipeline_requirements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.pipeline_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_requirements select for authenticated"
  ON public.pipeline_requirements;
CREATE POLICY "pipeline_requirements select for authenticated"
  ON public.pipeline_requirements FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "pipeline_requirements editor all"
  ON public.pipeline_requirements;
CREATE POLICY "pipeline_requirements editor all"
  ON public.pipeline_requirements FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_requirements TO authenticated;
GRANT ALL ON public.pipeline_requirements TO service_role;

CREATE TABLE IF NOT EXISTS public.pipeline_requirement_completions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES public.pipeline_requirements(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  completed_at   date NOT NULL,
  /* Card classes carry the card's own expiration; blank elsewhere. */
  expires_at     date,
  /* Where the fact came from: manual, paycom, lms, jotform… */
  source         text NOT NULL DEFAULT 'manual',
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prc_user_idx
  ON public.pipeline_requirement_completions (user_id);
CREATE INDEX IF NOT EXISTS prc_requirement_idx
  ON public.pipeline_requirement_completions (requirement_id, completed_at DESC);

DROP TRIGGER IF EXISTS prc_touch_updated_at
  ON public.pipeline_requirement_completions;
CREATE TRIGGER prc_touch_updated_at
  BEFORE UPDATE ON public.pipeline_requirement_completions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.pipeline_requirement_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prc board or self select"
  ON public.pipeline_requirement_completions;
CREATE POLICY "prc board or self select"
  ON public.pipeline_requirement_completions FOR SELECT
  TO authenticated
  USING (
    public.is_supervisor()
    OR public.is_pipeline_editor()
    OR public.is_fto_viewer()
    OR user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prc editor all"
  ON public.pipeline_requirement_completions;
CREATE POLICY "prc editor all"
  ON public.pipeline_requirement_completions FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_requirement_completions TO authenticated;
GRANT ALL ON public.pipeline_requirement_completions TO service_role;

/* Seed the known requirement catalog (editable in-app). */
INSERT INTO public.pipeline_requirements (name, cycle, sort, notes)
SELECT v.name, v.cycle, v.sort, v.notes
FROM (VALUES
  ('BLS Provider', 'certification', 10, 'AHA card — expirations tracked in Paycom'),
  ('ACLS Provider', 'certification', 20, 'AHA card — expirations tracked in Paycom'),
  ('PALS Provider', 'certification', 30, 'AHA card — expirations tracked in Paycom'),
  ('Sex Trafficking Prevention', 'per_cert_cycle', 40, 'Required once per TX licensure cycle'),
  ('Annual Protocol Test', 'annual', 50, 'Protocol test renews annually')
) AS v(name, cycle, sort, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_requirements p WHERE p.name = v.name);
