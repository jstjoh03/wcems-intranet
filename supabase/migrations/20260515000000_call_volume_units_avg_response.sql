-- ─────────────────────────────────────────────────────────────────────
-- 0040_call_volume_units_avg_response
--
-- Re-add per-unit average response time. It was originally on
-- call_volume_units and dropped in 0024 ("not collected per unit"),
-- but admins now want to enter it per unit (Medic 211/221/231/242/
-- 206/271, etc.) alongside runs.
--
-- Stored as integer seconds to match call_volume_summaries
-- .avg_response_seconds; the admin form converts mm:ss at the UI
-- boundary. Defaults to 0 so existing rows and partially-filled
-- months stay valid.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.call_volume_units
  ADD COLUMN IF NOT EXISTS avg_response_seconds integer NOT NULL DEFAULT 0;
