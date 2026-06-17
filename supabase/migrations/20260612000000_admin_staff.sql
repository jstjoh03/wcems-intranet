-- ─────────────────────────────────────────────────────────────────────
-- 0054_admin_staff
--
-- Move the Admin Staff directory from the hardcoded
-- src/data/admin-staff.json file into a real table so admins can edit
-- titles, contact info, and reorder cards without a code deploy.
--
-- Crew see active rows on /admin-staff (sorted by sort_order).
-- Admins manage all rows on /admin/admin-staff.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_staff (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  name         text NOT NULL,
  email        text,
  phone        text,
  notes        text,
  /* Lower numbers render first. Renumbered 0..N-1 on every reorder
     so there's no need for a unique constraint. */
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_staff_sort_order_idx
  ON public.admin_staff (sort_order);
CREATE INDEX IF NOT EXISTS admin_staff_active_idx
  ON public.admin_staff (active);

DROP TRIGGER IF EXISTS admin_staff_touch_updated_at ON public.admin_staff;
CREATE TRIGGER admin_staff_touch_updated_at
  BEFORE UPDATE ON public.admin_staff
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.admin_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_staff select for authenticated" ON public.admin_staff;
CREATE POLICY "admin_staff select for authenticated"
  ON public.admin_staff FOR SELECT
  TO authenticated USING (active = true OR public.is_admin());

DROP POLICY IF EXISTS "admin_staff admin all" ON public.admin_staff;
CREATE POLICY "admin_staff admin all"
  ON public.admin_staff FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_staff TO authenticated;
GRANT ALL ON public.admin_staff TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_staff'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_staff';
  END IF;
END$$;

ALTER TABLE public.admin_staff REPLICA IDENTITY FULL;

INSERT INTO public.admin_staff (title, name, email, phone, notes, sort_order)
SELECT * FROM (
  VALUES
    ('Medical Director', 'Aaron Buzzard, MD', 'aaron.buzzard@wallercountyems.com', '(210) 380-6017', 'Online medical control · Mon–Fri daytime hours', 0),
    ('Chief / EMS Director', 'Rhonda Getschman', 'rhonda.getschman@wallercountyems.com', '(281) 330-9193', NULL, 1),
    ('Assistant Chief', 'Heather Fojt', 'heather.fojt@wallercountyems.com', '(832) 520-6771', NULL, 2),
    ('Administrative Director', 'Rhonda Becvar', 'rhonda.becvar@wallercountyems.com', '(832) 367-7959', NULL, 3),
    ('Community Paramedic / Outreach Director', 'April Mancini', 'april.mancini@wallercountyems.com', '(281) 986-9226', NULL, 4),
    ('Administrative Manager / HR', 'Tori Bell', 'tori.bell@wallercountyems.com', '(512) 755-3495', NULL, 5),
    ('Supplies', 'Erica Adams', 'erica.adams@wallercountyems.com', '(832) 306-8761', NULL, 6),
    ('Clinical Coordinator', 'Open position', NULL, NULL, 'Position currently open', 7),
    ('Administration', 'Laurel Vandagriff', 'laurel.vandagriff@wallercountyems.com', '(832) 920-6323', NULL, 8)
) AS seed(title, name, email, phone, notes, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.admin_staff);
