-- Announcement comments (Justin, 2026-08-29): admins choose per
-- announcement whether crew can leave comments (first case: April's
-- remission post). Mirrors the spotlight congratulations thread —
-- same table shape, same RLS pattern — plus the toggle is enforced
-- server-side: posting is only possible while the announcement is
-- active AND has allow_comments on.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS allow_comments boolean NOT NULL DEFAULT false;

CREATE TABLE public.announcement_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX announcement_comments_announcement_idx
  ON public.announcement_comments (announcement_id, created_at);

ALTER TABLE public.announcement_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcement comments readable by authenticated"
  ON public.announcement_comments FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "post own announcement comments where allowed"
  ON public.announcement_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.announcements a
      WHERE a.id = announcement_id AND a.allow_comments AND a.active
    )
  );

CREATE POLICY "delete own announcement comments or admin"
  ON public.announcement_comments FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- RLS controls WHICH rows; GRANT controls WHICH operations.
GRANT SELECT, INSERT, DELETE ON TABLE public.announcement_comments TO authenticated;
GRANT ALL ON TABLE public.announcement_comments TO service_role;
