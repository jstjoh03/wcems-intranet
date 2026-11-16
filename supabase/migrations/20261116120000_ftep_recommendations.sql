-- ─────────────────────────────────────────────────────────────────────
-- ftep_recommendations
--
-- The "Final Release Recommendation (Standalone)" paper form run
-- in-portal (Justin, 2026-11-16): each recommender fills it out
-- independently, and the in-charge (P2) credential requires TWO on
-- file — the rec_letters credentialing gate self-completes from the
-- live count, same pattern as scored ICRs.
--
-- One row per letter. The signature is the recommender's, drawn on
-- device; the generated PDF files into the employee's documents at
-- submit. Letters are evaluator-facing paperwork: trainees do not see
-- these rows (the paper form was never trainee-facing either).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ftep_recommendations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id        uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  recommender_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  /* Which credentialing step the letter supports (pipeline transition
     key, e.g. P1_P2 / P1_P2_LEGACY) — definitions live in code. */
  transition        text NOT NULL,
  recommender_role  text NOT NULL CHECK (recommender_role IN ('fto','supervisor','cdo')),
  /* The paper form's attestations. */
  knowledge         boolean NOT NULL,  -- has demonstrated acceptable knowledge of policies & protocols
  safe_ethical      boolean NOT NULL,  -- operates in a safe, team-based, ethical manner
  comfortable       boolean NOT NULL,  -- "the only question that matters"
  recommendation    text NOT NULL CHECK (recommendation IN ('release','extend','separate')),
  basis             text,              -- narrative: specific, dated examples
  signature         text NOT NULL,     -- recommender signature (data URL)
  eval_date         date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Chicago')::date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ftep_recommendations_trainee_idx
  ON public.ftep_recommendations (trainee_id, transition);

ALTER TABLE public.ftep_recommendations ENABLE ROW LEVEL SECURITY;

-- Evaluators (FTOs/supervisors/editors + grants) read all letters;
-- trainees never see them, matching the paper workflow.
DROP POLICY IF EXISTS "ftep rec select" ON public.ftep_recommendations;
CREATE POLICY "ftep rec select"
  ON public.ftep_recommendations FOR SELECT
  TO authenticated
  USING (public.is_skills_evaluator());

-- A recommender files their own letter.
DROP POLICY IF EXISTS "ftep rec insert" ON public.ftep_recommendations;
CREATE POLICY "ftep rec insert"
  ON public.ftep_recommendations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_skills_evaluator()
    AND recommender_id = public.current_app_user_id()
    AND NOT public.is_kiosk_user()
  );

-- Corrections (a mis-filed letter) are editor-only.
DROP POLICY IF EXISTS "ftep rec editor delete" ON public.ftep_recommendations;
CREATE POLICY "ftep rec editor delete"
  ON public.ftep_recommendations FOR DELETE
  TO authenticated
  USING (public.is_pipeline_editor());
