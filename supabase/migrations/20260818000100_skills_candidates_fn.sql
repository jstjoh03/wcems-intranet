-- ─────────────────────────────────────────────────────────────────────
-- skills_candidates_fn
--
-- The Skills Day candidate list is the pending pipeline cohort, but
-- pipeline_records RLS only opens to supervisors/editors/FTOs/self —
-- a grant-only skills evaluator (e.g. the admin EMT running the BLS
-- trauma station) would see an empty list. This SECURITY DEFINER
-- function exposes just the cohort's identity (id, name, title),
-- which is directory-level data any authenticated user can already
-- see, without opening the pipeline itself.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.skills_candidates()
RETURNS TABLE (id uuid, full_name text, title text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.full_name, u.title
  FROM public.pipeline_records r
  JOIN public.app_users u ON u.id = r.user_id
  WHERE r.pending = true
  ORDER BY u.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.skills_candidates() TO authenticated;
