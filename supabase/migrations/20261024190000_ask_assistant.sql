-- ─────────────────────────────────────────────────────────────────────
-- Ask WCEMS — AI how-to assistant (Phase 1)
--
-- Two tables behind the ask-assistant edge function + chat panel:
--
--   assistant_messages          one immutable row per Q&A exchange, written
--                               ONLY by the edge function (service role) —
--                               token counts + computed cost ride along so
--                               /admin/assistant can show month-to-date
--                               spend without calling Anthropic's console.
--
--   assistant_feature_requests  questions the assistant couldn't answer,
--                               sent by the user as a "add this to the
--                               intranet" request (plus a quiet manual
--                               "Suggest a feature" path). Inserted straight
--                               from the Vue client under RLS; triaged by
--                               admins on /admin/assistant → Requests.
--
-- RLS: users read their own rows in both tables (so the panel can show
-- "you already asked for this"); admins read everything and update
-- request triage fields. No client writes to assistant_messages at all.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL DEFAULT '',
  model text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  est_cost_usd numeric(8,5) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'rate_limited')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Daily rate-limit count + "recent questions" listings both hit this.
CREATE INDEX IF NOT EXISTS assistant_messages_user_created_idx
  ON public.assistant_messages (user_id, created_at);

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assistant_messages select"
  ON public.assistant_messages FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin());

-- No INSERT/UPDATE/DELETE policies for authenticated: the log is
-- edge-function-only (service role bypasses RLS).

CREATE TABLE IF NOT EXISTS public.assistant_feature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  question text NOT NULL,
  note text,
  kind text NOT NULL DEFAULT 'feature' CHECK (kind IN ('feature', 'docs_gap', 'bug', 'other')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'done', 'declined')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS assistant_feature_requests_touch_updated_at ON public.assistant_feature_requests;
CREATE TRIGGER assistant_feature_requests_touch_updated_at
  BEFORE UPDATE ON public.assistant_feature_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.assistant_feature_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assistant_feature_requests insert own"
  ON public.assistant_feature_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY "assistant_feature_requests select"
  ON public.assistant_feature_requests FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin());

-- Triage (kind/status/admin_note) is admin-only.
CREATE POLICY "assistant_feature_requests admin update"
  ON public.assistant_feature_requests FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.assistant_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.assistant_feature_requests TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;
GRANT ALL ON public.assistant_feature_requests TO service_role;
