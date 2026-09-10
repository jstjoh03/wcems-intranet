-- Admins curate the kudos inbox at /admin/kudos (delete test/junk rows).
create policy "kudos_delete_admins" on public.kudos_submissions
  for delete to authenticated
  using (public.is_admin() or public.is_pipeline_editor());
