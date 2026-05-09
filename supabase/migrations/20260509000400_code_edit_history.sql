-- ─────────────────────────────────────────────────────────────────────
-- 0005_code_edit_history
--
-- Append-only audit log for door-code changes on stations and hospitals.
-- The stations and hospitals tables (next two migrations) carry stamp
-- triggers that auto-populate `*_updated_at`/`*_updated_by` and audit
-- triggers that INSERT a row here on every code change.
--
-- Rows are NEVER updated or deleted by clients — the table is treated
-- as immutable history. RLS enforces that:
--   • All authenticated users can SELECT the full log (so the inline
--     "Updated by Justin · 3d ago" stamp resolves correctly even after
--     the user record is mutated).
--   • Only admins can DELETE (e.g. cleaning up test rows).
--   • Nobody can INSERT directly via the API; only the audit triggers
--     (SECURITY DEFINER on the table-side functions) write to it.
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.code_entity_type AS ENUM ('station', 'hospital');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.code_field AS ENUM ('door', 'er', 'ems_room');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.code_edit_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         public.code_entity_type NOT NULL,
  entity_id           text NOT NULL,
  code_field          public.code_field NOT NULL,
  old_value           text NOT NULL DEFAULT '',
  new_value           text NOT NULL DEFAULT '',
  changed_by          text NOT NULL,
  changed_by_user_id  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  changed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS code_edit_history_entity_idx
  ON public.code_edit_history (entity_type, entity_id, changed_at DESC);

ALTER TABLE public.code_edit_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "code_edit_history select for authenticated"
  ON public.code_edit_history;
CREATE POLICY "code_edit_history select for authenticated"
  ON public.code_edit_history FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "code_edit_history admin delete" ON public.code_edit_history;
CREATE POLICY "code_edit_history admin delete"
  ON public.code_edit_history FOR DELETE
  TO authenticated USING (public.is_admin());

GRANT SELECT, DELETE ON public.code_edit_history TO authenticated;
-- INSERT/UPDATE intentionally NOT granted; SECURITY DEFINER triggers in
-- the next two migrations handle inserts.
