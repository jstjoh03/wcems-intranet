-- ─────────────────────────────────────────────────────────────────────
-- 2026 Protocol Update — skills verification campaign (2026-10-23)
--
-- Every credentialed employee watches Dr. Buzzard's update video
-- (Required Training module — existing machinery) and then completes a
-- hands-on verification for each skill NEW to their scope. This is the
-- digital check-off: Skills-Day-style section/item lists, pass or
-- remediation, dual signatures, printable blank PDFs as paper backup.
--
-- DELIBERATELY SEPARATE from the NEOP Skills Day tables
-- (skills_checkoffs / skills_evaluations) — that module goes live with
-- the Oct 26 cohort and must not be destabilized. Same shapes, so the
-- runner UX ports; different tables, roster (all credentialed staff by
-- cert level, EMR excluded by never listing it) and lifecycle
-- (campaign opens → everyone verifies → campaign closes).
--
--  1. protocol_skill_campaigns  — one row per rollout (protocol-2026)
--  2. protocol_skill_checkoffs  — the skill catalog, required_levels
--     drives who owes it ('EMT-B','ADV EMT','EMT-P','LP')
--  3. protocol_skill_verifications — one row per person per skill,
--     items keyed like Skills Day, dual signatures
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.protocol_skill_campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_by      date,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.protocol_skill_checkoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.protocol_skill_campaigns(id) ON DELETE CASCADE,
  key             text NOT NULL,
  title           text NOT NULL,
  subtitle        text NOT NULL DEFAULT '',
  note            text NOT NULL DEFAULT '',
  sections        jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_levels text[] NOT NULL DEFAULT '{}',
  sort            integer NOT NULL DEFAULT 100,
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (campaign_id, key)
);

CREATE TABLE IF NOT EXISTS public.protocol_skill_verifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkoff_id         uuid NOT NULL REFERENCES public.protocol_skill_checkoffs(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  evaluator_id        uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  eval_date           date NOT NULL DEFAULT CURRENT_DATE,
  items               jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall             text NOT NULL DEFAULT 'pass' CHECK (overall IN ('pass', 'remediation')),
  candidate_signature text,
  evaluator_signature text,
  note                text,
  submitted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS protocol_skill_verifications_user_idx
  ON public.protocol_skill_verifications (user_id, checkoff_id);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.protocol_skill_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_skill_checkoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_skill_verifications ENABLE ROW LEVEL SECURITY;

-- Catalog: everyone signed in may read; clinical editors/admins manage.
DROP POLICY IF EXISTS "psc select" ON public.protocol_skill_campaigns;
CREATE POLICY "psc select" ON public.protocol_skill_campaigns
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "psc write" ON public.protocol_skill_campaigns;
CREATE POLICY "psc write" ON public.protocol_skill_campaigns
  FOR ALL TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

DROP POLICY IF EXISTS "psk select" ON public.protocol_skill_checkoffs;
CREATE POLICY "psk select" ON public.protocol_skill_checkoffs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "psk write" ON public.protocol_skill_checkoffs;
CREATE POLICY "psk write" ON public.protocol_skill_checkoffs
  FOR ALL TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

-- Verifications: the person sees their own; evaluators, supervisors and
-- admins see all; skills evaluators write (same grant as Skills Day);
-- admins/clinical editors correct or remove.
DROP POLICY IF EXISTS "psv select" ON public.protocol_skill_verifications;
CREATE POLICY "psv select" ON public.protocol_skill_verifications
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR public.is_admin()
    OR public.is_supervisor()
    OR public.is_skills_evaluator()
    OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
               WHERE pe.user_id = public.current_app_user_id())
  );
DROP POLICY IF EXISTS "psv insert" ON public.protocol_skill_verifications;
CREATE POLICY "psv insert" ON public.protocol_skill_verifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_skills_evaluator());
DROP POLICY IF EXISTS "psv delete" ON public.protocol_skill_verifications;
CREATE POLICY "psv delete" ON public.protocol_skill_verifications
  FOR DELETE TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocol_skill_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocol_skill_checkoffs TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.protocol_skill_verifications TO authenticated;

-- ── Seed: the 2026 campaign + the skills new to each scope ───────────
-- Item lists drafted 1:1 from Dr. Buzzard's training deck and the rev3
-- pages; the catalog is editable in-app, so wording lives in DATA.
DO $$
DECLARE
  v_campaign uuid;
BEGIN
  INSERT INTO public.protocol_skill_campaigns (key, title, description, due_by, active)
  VALUES (
    'protocol-2026',
    '2026 Protocol Update — Skills Verification',
    'Hands-on verification for every skill new to your scope in the 2026 Protocols, Procedures and Directives. Watch Dr. Buzzard''s update video first, then an evaluator checks each skill off with you.',
    NULL,
    true
  )
  ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title
  RETURNING id INTO v_campaign;

  INSERT INTO public.protocol_skill_checkoffs
    (campaign_id, key, title, subtitle, note, required_levels, sort, sections)
  VALUES
  (v_campaign, 'cpap-standalone', 'Standalone CPAP',
   '1.20 CPAP · new to the EMT band of 2.07, 2.16, 2.18, 2.37, 2.41, 2.43',
   'Standalone device only — ventilator CPAP stays excluded at the EMT level.',
   ARRAY['EMT-B'], 10,
   '[{"title":"Indications & limits","items":[
      {"key":"1","label":"States the indications: severe respiratory distress with an adequate respiratory drive (asthma, COPD, near drowning, pulmonary edema, general respiratory distress)"},
      {"key":"2","label":"Cardiogenic shock: states CPAP is only with pulmonary edema AND SBP 90 or above (2.16)"},
      {"key":"3","label":"States contraindications: apnea or inadequate drive, vomiting, inability to protect the airway, inability to tolerate the mask"},
      {"key":"4","label":"States the standalone-only limit: ventilator CPAP is excluded at the EMT level"}]},
    {"title":"Application","items":[
      {"key":"5","label":"Assembles the device and oxygen source; selects the correct mask size"},
      {"key":"6","label":"Explains the procedure and coaches the patient through mask placement"},
      {"key":"7","label":"Applies at 5 cmH2O and titrates 5–10 cmH2O to effect"},
      {"key":"8","label":"Monitors SpO2, mental status and work of breathing continuously"}]},
    {"title":"Failure & documentation","items":[
      {"key":"9","label":"States the failure criteria and the move to BVM with escalation"},
      {"key":"10","label":"Documents settings, duration and patient response"}]}]'::jsonb),

  (v_campaign, 'apap-po', 'Acetaminophen PO',
   'New medication · EMT band of 2.14, 2.24, 2.35, 2.36, 2.39, 2.45',
   'Fever or minor pain (<4/10). Paramedics verify PO and IV together on the Paramedic check-off.',
   ARRAY['EMT-B','ADV EMT'], 20,
   '[{"title":"Indications & safety","items":[
      {"key":"1","label":"States the indications: fever, or minor pain less than 4/10"},
      {"key":"2","label":"States the do-not-give rules: within 4 hours of a correct dose, or known liver disease"},
      {"key":"3","label":"States: under 12 weeks of age or under 5 kg — contact Medical Control"}]},
    {"title":"Dosing","items":[
      {"key":"4","label":"Adult: 1000 mg PO"},
      {"key":"5","label":"Pediatric: doses by the chart from 5 to 35 kg; over 35 kg = 1000 mg"},
      {"key":"6","label":"Checks the bottle concentration (the chart assumes 160 mg/5 mL)"}]},
    {"title":"Administration","items":[
      {"key":"7","label":"Performs the medication cross-check (right patient, drug, dose, route, time; allergies)"},
      {"key":"8","label":"Administers, reassesses and documents"}]}]'::jsonb),

  (v_campaign, 'naloxone-in', 'Naloxone IN',
   'New to the EMT band · 2.05 Altered Mental Status, 2.38 Overdose & Poisoning',
   'Ventilation comes first — naloxone is titrated to respirations, never to wakefulness.',
   ARRAY['EMT-B'], 30,
   '[{"title":"Indications","items":[
      {"key":"1","label":"States the indication: suspected opioid overdose with respiratory depression"},
      {"key":"2","label":"States ventilation and oxygenation come FIRST (OPA/NPA, BVM)"}]},
    {"title":"Dosing & technique","items":[
      {"key":"3","label":"Adult: 0.5–1 mg IN, may repeat every 2–5 minutes"},
      {"key":"4","label":"Pediatric: 0.1 mg/kg IN, max single dose 1 mg, may repeat every 2–5 minutes"},
      {"key":"5","label":"Assembles the mucosal atomization device correctly"},
      {"key":"6","label":"Splits the volume between nares; verbalizes the per-naris volume limit"}]},
    {"title":"After administration","items":[
      {"key":"7","label":"Titrates to adequate respirations, not full wakefulness"},
      {"key":"8","label":"Reassesses, anticipates re-sedation, documents response"}]}]'::jsonb),

  (v_campaign, 'aemt-12lead', 'Cardiac monitor & 12-lead acquisition',
   'Advanced EMT · 1.30 12 Lead ECG, 2.17 Chest Pain & STEMI, 1.03 AEMT-Led ALS Unit',
   'Acquire and transmit — a paramedic or physician interprets. Never the AEMT.',
   ARRAY['ADV EMT'], 40,
   '[{"title":"Application","items":[
      {"key":"1","label":"Applies limb leads correctly"},
      {"key":"2","label":"Places V1–V6 on the correct landmarks"},
      {"key":"3","label":"Acquires a clean, artifact-free 12 lead"}]},
    {"title":"Timing & transmission","items":[
      {"key":"4","label":"States: first 12 lead within 5 minutes of patient contact for chest pain (2.17)"},
      {"key":"5","label":"Transmits to the receiving facility AND the supervisor"},
      {"key":"6","label":"States repeats: after ROSC, after nitroglycerin, and with any change; serial cadence (unstable 5–10 min, stable 10–15)"}]},
    {"title":"Interpretation rules","items":[
      {"key":"7","label":"States: interpretation is a paramedic or physician only — the AEMT never interprets"},
      {"key":"8","label":"States: on an AEMT-led unit, an automated acute-MI statement is treated as STEMI until a paramedic or physician says otherwise (1.03)"},
      {"key":"9","label":"States: before any nitroglycerin, the 12 lead is read by a paramedic or physician (2.17)"},
      {"key":"10","label":"Documents who it was transmitted to and the interpreting provider in the ePCR"}]}]'::jsonb),

  (v_campaign, 'aemt-epi-arrest', 'Epinephrine in cardiac arrest',
   'New to the Advanced EMT band · 2.08 Asystole, 2.42 PEA, 2.52 VF & Pulseless VT',
   '',
   ARRAY['ADV EMT'], 50,
   '[{"title":"Preparation","items":[
      {"key":"1","label":"Identifies epinephrine 1:10,000 and its prefilled packaging"},
      {"key":"2","label":"Performs the medication cross-check with a partner"}]},
    {"title":"Dosing","items":[
      {"key":"3","label":"Adult: 1 mg IVP or IO every 5 minutes"},
      {"key":"4","label":"Pediatric: 0.01 mg/kg IVP or IO, max single dose 1 mg, every 5 minutes"}]},
    {"title":"Administration","items":[
      {"key":"5","label":"Times administration with ongoing compressions; minimal interruption"},
      {"key":"6","label":"Flushes the line after each dose"},
      {"key":"7","label":"Verbalizes the dose and time to the team and documents"}]}]'::jsonb),

  (v_campaign, 'aemt-ondansetron', 'Ondansetron',
   'Moved to the Advanced EMT level · ordered for nausea/vomiting across 23 protocols',
   '',
   ARRAY['ADV EMT'], 60,
   '[{"title":"Indications & safety","items":[
      {"key":"1","label":"States the indication: nausea or vomiting"},
      {"key":"2","label":"States the correct adult and pediatric dose and routes per the Medication Booklet"},
      {"key":"3","label":"States the precautions and when Medical Control is required"}]},
    {"title":"Administration","items":[
      {"key":"4","label":"Performs the medication cross-check"},
      {"key":"5","label":"Administers by the chosen route correctly (ODT / IV / IM)"},
      {"key":"6","label":"Reassesses and documents"}]}]'::jsonb),

  (v_campaign, 'aemt-diphenhydramine', 'Diphenhydramine IV/IO/IM',
   'Moved to the Advanced EMT level · allergic reactions + NEW dystonic reaction/akathisia (2.38, 2.11)',
   '',
   ARRAY['ADV EMT'], 70,
   '[{"title":"Indications","items":[
      {"key":"1","label":"States the allergic-reaction indications (2.02, 2.03, 2.04, 2.12)"},
      {"key":"2","label":"Recognizes an acute dystonic reaction: sustained spasms of the neck, jaw, tongue or eyes"},
      {"key":"3","label":"Recognizes akathisia: intense restlessness, cannot sit still"},
      {"key":"4","label":"States droperidol can cause both — 2.11 Behavioral Emergency points to 2.38"}]},
    {"title":"Dosing","items":[
      {"key":"5","label":"Adult: 50 mg slow IV/IO or IM"},
      {"key":"6","label":"Pediatric: 1 mg/kg slow IV/IO or IM, max single dose 25 mg"}]},
    {"title":"Administration","items":[
      {"key":"7","label":"Performs the medication cross-check"},
      {"key":"8","label":"Demonstrates a correct IM site and technique, or a slow IV push"},
      {"key":"9","label":"Reassesses and documents"}]}]'::jsonb),

  (v_campaign, 'medic-cefazolin', 'Cefazolin (Ancef) — mixing & administration',
   'New medication · Paramedic · 2.06 Amputated Part, 2.35 Multi System Trauma, 2.36 Musculoskeletal Trauma',
   'Supplied as 1 g vials of powder — an adult dose is two vials.',
   ARRAY['EMT-P','LP'], 80,
   '[{"title":"Indications & safety","items":[
      {"key":"1","label":"States the indication: open fractures and open traumatic wounds, including amputation, if time permits"},
      {"key":"2","label":"States: cephalosporin allergy — do not give; anaphylaxis to penicillin or another beta-lactam — relative contraindication"},
      {"key":"3","label":"States: not for 1 month of age or younger"}]},
    {"title":"Mixing","items":[
      {"key":"4","label":"Verifies drug, dose, expiration and allergies"},
      {"key":"5","label":"Adds 10 mL NS to EACH 1 g vial using a flush"},
      {"key":"6","label":"Injects and swirls until dissolved; inspects for particles or discoloration"}]},
    {"title":"Dosing & administration","items":[
      {"key":"7","label":"Adult: 2 g IV/IO — both vials"},
      {"key":"8","label":"Pediatric (older than 1 month): 50 mg/kg IV/IO, max single dose 2 g — about 0.5 mL/kg of the ~95 mg/mL mix"},
      {"key":"9","label":"Administers, watches for an allergic reaction (treat per 2.02), documents"}]}]'::jsonb),

  (v_campaign, 'medic-apap-iv', 'Acetaminophen PO & IV infusion',
   'New medication · Paramedic · 2.39 Pain Management (Non-Cardiac), 1.47 Infusion Calculations',
   '',
   ARRAY['EMT-P','LP'], 90,
   '[{"title":"Indications & safety","items":[
      {"key":"1","label":"States the indication: pain — 1000 mg PO, or the IV infusion over 15 minutes"},
      {"key":"2","label":"States the do-not-give rules: within 4 hours of a correct dose, or known liver disease"}]},
    {"title":"IV dosing","items":[
      {"key":"3","label":"More than 66 kg: 1000 mg IV over 15 minutes — the whole premixed bag"},
      {"key":"4","label":"66 kg or less: 15 mg/kg IV (1.5 mL/kg) over 15 minutes — withdraws the dose, NEVER hangs the full bag"}]},
    {"title":"Administration","items":[
      {"key":"5","label":"Sets up the infusion and rate correctly for a 15-minute administration"},
      {"key":"6","label":"Performs the medication cross-check, reassesses and documents"}]}]'::jsonb),

  (v_campaign, 'medic-pushdose-norepi', 'Push-dose norepinephrine',
   'New use · Paramedic · 1.10 Airway Management (pre-DSI), 2.16 Cardiogenic Shock, 2.45 Sepsis',
   'Both push doses are in 1.47 Infusion Calculations.',
   ARRAY['EMT-P','LP'], 100,
   '[{"title":"Indications","items":[
      {"key":"1","label":"States the indications: hypotension before DSI (1.10), cardiogenic shock (2.16), sepsis (2.45) — an alternative to push-dose epinephrine"}]},
    {"title":"Mixing & dosing","items":[
      {"key":"2","label":"Mixes 4 mg in 250 mL D5W = 16 mcg/mL — the same bag as the infusion (NS if no D5W)"},
      {"key":"3","label":"Draws 1 mL from the bag and labels the syringe"},
      {"key":"4","label":"Gives 0.25–1 mL (4–16 mcg) per dose"},
      {"key":"5","label":"Repeats every 2–5 minutes to the SBP target of the protocol"}]},
    {"title":"Administration","items":[
      {"key":"6","label":"Performs the medication cross-check"},
      {"key":"7","label":"Reassesses pressure after each dose and documents"}]}]'::jsonb),

  (v_campaign, 'medic-needle-cric', 'Needle cricothyrotomy',
   'New procedure · Paramedic · 1.16 Needle Cricothyrotomy',
   'A child under 12 when all other airway means have failed. 12 and older: 1.17 Surgical Cricothyrotomy.',
   ARRAY['EMT-P','LP'], 110,
   '[{"title":"Indications & kit","items":[
      {"key":"1","label":"States the indication: under 12 years with a failed airway after all other means"},
      {"key":"2","label":"States: 12 and older goes to 1.17 Surgical Cricothyrotomy"},
      {"key":"3","label":"Assembles the kit: 10 mL saline flush, 14-gauge catheter, 3.0 mm ET tube adapter"}]},
    {"title":"Procedure","items":[
      {"key":"4","label":"Identifies the cricothyroid membrane landmarks"},
      {"key":"5","label":"Advances with aspiration — bubbles in the saline confirm the trachea"},
      {"key":"6","label":"Advances the catheter off the needle and holds the hub at all times"},
      {"key":"7","label":"Connects the BVM via the 3.0 ET adapter"}]},
    {"title":"Ventilation & transport","items":[
      {"key":"8","label":"Ventilates 1 second in, 4 seconds out, with waveform capnography"},
      {"key":"9","label":"States it is a temporary airway — transport without delay"},
      {"key":"10","label":"Documents the procedure, times and confirmation"}]}]'::jsonb)
  ON CONFLICT (campaign_id, key) DO NOTHING;
END $$;
