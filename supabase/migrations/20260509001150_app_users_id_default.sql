-- ─────────────────────────────────────────────────────────────────────
-- 0012b_app_users_id_default
--
-- Migration 0012 decoupled `app_users.id` from `auth.users(id)` but
-- left the column with no DEFAULT. The original 0001 migration relied
-- on every insert supplying `id = auth.uid()` (because the trigger
-- and the seed UPDATEs were the only callers). Now that the bulk-seed
-- migration (0013) inserts rows WITHOUT specifying an id, the column
-- needs a default uuid generator.
--
-- This is a one-line fix that should have been part of 0012; pulling
-- it forward as its own migration keeps history honest.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.app_users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
