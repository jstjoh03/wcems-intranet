-- ─────────────────────────────────────────────────────────────────────
-- QOTW answer key + teaching point (Justin, 2026-11-17)
--
-- Quiz-style questions carry a right answer and a teaching point that
-- reveal the moment the employee locks in their answer (instant
-- gratification), or once the question archives. The key lives in its
-- OWN table so RLS can hide it beforehand: row-level policies can't
-- hide columns, and a devtools select on qotw_questions would have
-- leaked the answer before they answered.
--
-- Anti-cheat: on a question that HAS a key, a vote is immutable —
-- no update, no delete-and-revote — because the answer shows right
-- after voting. Opinion polls (no key) stay changeable.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.qotw_answer_keys (
  question_id     uuid PRIMARY KEY REFERENCES public.qotw_questions(id) ON DELETE CASCADE,
  /* Poll questions: index of the correct option (0–3); NULL for
     open-text questions that only carry a teaching point. */
  correct_option  int CHECK (correct_option BETWEEN 0 AND 3),
  teaching_point  text CHECK (teaching_point IS NULL OR char_length(teaching_point) <= 2000),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qotw_answer_keys ENABLE ROW LEVEL SECURITY;

-- Readable once YOU have answered (voted or commented), once the
-- question is archived, or always for admins.
DROP POLICY IF EXISTS "qotw key select" ON public.qotw_answer_keys;
CREATE POLICY "qotw key select"
  ON public.qotw_answer_keys FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.qotw_questions q
      WHERE q.id = question_id AND q.status = 'archived'
    )
    OR EXISTS (
      SELECT 1 FROM public.qotw_votes v
      WHERE v.question_id = qotw_answer_keys.question_id
        AND v.user_id = public.current_app_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM public.qotw_comments c
      WHERE c.question_id = qotw_answer_keys.question_id
        AND c.user_id = public.current_app_user_id()
    )
  );

DROP POLICY IF EXISTS "qotw key admin write" ON public.qotw_answer_keys;
CREATE POLICY "qotw key admin write"
  ON public.qotw_answer_keys FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qotw_answer_keys TO authenticated;
GRANT ALL ON public.qotw_answer_keys TO service_role;

-- Votes LOCK on keyed questions: the answer shows right after voting,
-- so changing or re-casting would be an open-book rewrite.
DROP POLICY IF EXISTS "qotw votes update" ON public.qotw_votes;
CREATE POLICY "qotw votes update"
  ON public.qotw_votes FOR UPDATE
  TO authenticated
  USING (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
    AND NOT EXISTS (
      SELECT 1 FROM public.qotw_answer_keys k WHERE k.question_id = qotw_votes.question_id
    )
  )
  WITH CHECK (public.current_app_user_id() = user_id);

DROP POLICY IF EXISTS "qotw votes delete" ON public.qotw_votes;
CREATE POLICY "qotw votes delete"
  ON public.qotw_votes FOR DELETE
  TO authenticated
  USING (
    public.current_app_user_id() = user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.qotw_answer_keys k WHERE k.question_id = qotw_votes.question_id
    )
  );
