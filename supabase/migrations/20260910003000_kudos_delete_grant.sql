-- The delete POLICY landed without the table-level DELETE privilege --
-- PostgREST refused the UI delete. RLS still scopes it to admins/editors.
grant delete on public.kudos_submissions to authenticated;
