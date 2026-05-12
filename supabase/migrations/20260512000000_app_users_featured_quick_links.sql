-- ─────────────────────────────────────────────────────────────────────
-- 0033_app_users_featured_quick_links
--
-- Per-user customization for the featured-shortcut strip under the
-- dashboard hero. Each user can pick up to 4 quick_links.id values
-- to fill tiles 1–4; tile 5 (Hospitals, internal route) is fixed.
-- Empty array = fall back to role-based defaults.
--
-- Self-editable: the column-lock trigger
-- (enforce_app_users_self_update_columns) only checks explicit
-- columns, so this new column is implicitly allowed for non-admin
-- self-updates — exactly what we want.
--
-- Type is `text[]` rather than `uuid[]` because storing as text keeps
-- migration / array literal handling simple, and we don't enforce
-- referential integrity on array elements either way.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS featured_quick_link_ids text[] NOT NULL DEFAULT '{}';
