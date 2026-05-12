-- ─────────────────────────────────────────────────────────────────────
-- 0032_quick_links_seed
--
-- Backfill the quick_links catalog from the legacy
-- `src/data/quicklinks.json` fixture (24 entries).
-- Idempotent: ON CONFLICT on `label` so re-runs converge to seed
-- values without duplicating.
-- ─────────────────────────────────────────────────────────────────────

-- Make `label` unique so ON CONFLICT (label) has a constraint to
-- target. Safe to add now since it's empty. Duplicate labels would
-- be confusing in the admin UI anyway.
ALTER TABLE public.quick_links
  ADD CONSTRAINT quick_links_label_unique UNIQUE (label);

INSERT INTO public.quick_links
  (label, sub, url, icon_name, category, visible_to, sort_order)
VALUES
  ('Responder360', 'CAD & situational awareness', 'https://app.responder360.com/', 'Radar', 'Field & Ops', ARRAY['supervisor', 'admin']::text[], 5),
  ('Operative IQ', 'Narcotic tracking', 'https://login.operativeiq.com/Login.aspx?identifier=wallercountyems', 'Package', 'Field & Ops', ARRAY['crew', 'supervisor', 'admin']::text[], 10),
  ('PSTrax', 'Daily truck checks', 'https://app1.pstrax.com', 'Truck', 'Field & Ops', ARRAY['crew', 'supervisor', 'admin']::text[], 20),
  ('ESO', 'ePCR', 'https://esosuite.net/login/wcemseso', 'Stethoscope', 'Field & Ops', ARRAY['crew', 'supervisor', 'admin']::text[], 30),
  ('Pulsara', 'Hospital patient reports', 'https://us-app.pulsara.com/user/login', 'Activity', 'Field & Ops', ARRAY['crew', 'supervisor', 'admin']::text[], 40),
  ('Protocols', 'Reference', 'https://protocols.wallercountyems.com', 'BookOpen', 'Field & Ops', ARRAY['crew', 'supervisor', 'admin']::text[], 50),
  ('Outlook', 'M365 mail', 'https://outlook.cloud.microsoft/mail/', 'Mail', 'Communication', ARRAY['crew', 'supervisor', 'admin']::text[], 110),
  ('Microsoft Teams', 'Chat', 'https://teams.cloud.microsoft/', 'MessageSquare', 'Communication', ARRAY['crew', 'supervisor', 'admin']::text[], 120),
  ('Aladtec', 'Schedule', 'https://aladtec.com/wcvems', 'Calendar', 'Schedule & Pay', ARRAY['crew', 'supervisor', 'admin']::text[], 210),
  ('Paycom', 'Time & pay', 'https://www.paycomonline.net/v4/ee/web.php/app/login', 'ClipboardList', 'Schedule & Pay', ARRAY['crew', 'supervisor', 'admin']::text[], 220),
  ('Internal Education', 'CE catalog', 'https://www.wallercountyems.com/internaleducation', 'GraduationCap', 'Training', ARRAY['crew', 'supervisor', 'admin']::text[], 310),
  ('EMS1 Academy', 'Self-paced CE', 'https://olt.ems1academy.com/login/', 'BookOpen', 'Training', ARRAY['crew', 'supervisor', 'admin']::text[], 320),
  ('NREMT', 'National registry', 'https://nremt.org/login', 'FileCheck', 'Licensure', ARRAY['crew', 'supervisor', 'admin']::text[], 410),
  ('Texas DSHS', 'State licensing', 'https://vo.ras.dshs.state.tx.us/datamart/login.do', 'Shield', 'Licensure', ARRAY['crew', 'supervisor', 'admin']::text[], 420),
  ('Supply Portal', 'Station orders', 'https://wallercountyems.com/supplies', 'ShoppingCart', 'Internal', ARRAY['crew', 'supervisor', 'admin']::text[], 510),
  ('Uniforms', 'Orders & reimbursement', 'https://uniforms.wallercountyems.com', 'Shirt', 'Internal', ARRAY['crew', 'supervisor', 'admin']::text[], 520),
  ('Employee Shoutout', 'Recognize a teammate', 'https://form.jotform.com/261249366820056', 'Award', 'Internal', ARRAY['crew', 'supervisor', 'admin']::text[], 530),
  ('Daily Summary', 'Supervisor end-of-shift report', 'https://form.jotform.com/251117115417043', 'ClipboardCheck', 'Internal', ARRAY['supervisor', 'admin']::text[], 540)
ON CONFLICT (label) DO UPDATE SET
  sub = EXCLUDED.sub,
  url = EXCLUDED.url,
  icon_name = EXCLUDED.icon_name,
  category = EXCLUDED.category,
  visible_to = EXCLUDED.visible_to,
  sort_order = EXCLUDED.sort_order;
