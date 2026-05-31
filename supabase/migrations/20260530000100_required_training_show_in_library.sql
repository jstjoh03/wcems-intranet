-- ─────────────────────────────────────────────────────────────────────
-- 0047_required_training_show_in_library
--
-- Cross-list required-training modules into the Training Library so
-- crew can find them via the same browse/search UI used for optional
-- reference videos. Required modules stay accessible even after every
-- assigned person has completed — admins shouldn't need to "archive"
-- a module just to remove the compliance pressure.
--
-- Default true so every existing module shows up by default; admin
-- can opt out per-module via a checkbox in the edit form.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.required_trainings
  ADD COLUMN IF NOT EXISTS show_in_library boolean NOT NULL DEFAULT true;
