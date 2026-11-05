-- Supervisors read required-training completion progress (2026-11-04,
-- applied live). The roster view at /admin/required-training/:id is now
-- supervisor-visible read-only (overrides, mark-complete and the note
-- stay admin); these SELECT policies let it load everyone's completions
-- and the audience overrides. Writes are untouched; is_supervisor()
-- already includes admins.
create policy "rtc supervisor select" on required_training_completions
  for select to authenticated using (is_supervisor());
create policy "rt_overrides supervisor select" on required_training_user_overrides
  for select to authenticated using (is_supervisor());
