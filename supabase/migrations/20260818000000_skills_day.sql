-- ─────────────────────────────────────────────────────────────────────
-- skills_day
--
-- NEOP Skills Day check-off system. Replaces the Jotform competency
-- forms: evaluators run each station from their phone, mark items
-- pass/redo, capture both signatures, and submit. One evaluation row
-- per (checkoff, candidate); item-level rechecks update the row and
-- append to a recheck log (guide rule: a missed item never stops the
-- rotation — it's revisited at the end of the day).
--
-- Checkoff definitions live in the DB (sections jsonb) so the CDO can
-- edit item lists in-app — the medication dose-and-draw list "may
-- change on the day".
--
-- Evaluators = admins + supervisors + FTOs automatically, plus a
-- person-specific grant table (skills_evaluators) for extras like the
-- admin EMT running the BLS trauma station.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Checkoff definitions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skills_checkoffs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  title       text NOT NULL,
  subtitle    text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  /* [{ "title": "...", "note": "...", "items": [{ "key": "...", "label": "..." }] }] */
  sections    jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort        integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS skills_checkoffs_touch_updated_at ON public.skills_checkoffs;
CREATE TRIGGER skills_checkoffs_touch_updated_at
  BEFORE UPDATE ON public.skills_checkoffs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Evaluator grant + helper ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skills_evaluators (
  user_id     uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_skills_evaluator()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.is_admin()
      OR public.is_supervisor()
      OR public.is_fto_viewer()
      OR EXISTS (
           SELECT 1 FROM public.skills_evaluators se
           WHERE se.user_id = public.current_app_user_id()
         );
$$;

GRANT EXECUTE ON FUNCTION public.is_skills_evaluator() TO authenticated;

-- 3) Evaluations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skills_evaluations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkoff_id           uuid NOT NULL REFERENCES public.skills_checkoffs(id) ON DELETE CASCADE,
  candidate_id          uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  evaluator_id          uuid NOT NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  eval_date             date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Chicago')::date,
  /* { "<item_key>": { "result": "pass" | "redo", "comment": "..." } } */
  items                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall               text NOT NULL CHECK (overall IN ('pass','remediation')),
  candidate_signature   text,
  evaluator_signature   text,
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  /* Append-only log of end-of-day item rechecks:
     [{ "at": iso, "evaluator_id": uuid, "items": ["key", ...],
        "candidate_signature": dataurl, "evaluator_signature": dataurl }] */
  rechecks              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checkoff_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS skills_evaluations_candidate_idx
  ON public.skills_evaluations (candidate_id);

DROP TRIGGER IF EXISTS skills_evaluations_touch_updated_at ON public.skills_evaluations;
CREATE TRIGGER skills_evaluations_touch_updated_at
  BEFORE UPDATE ON public.skills_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.skills_checkoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills_evaluators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skills_checkoffs select" ON public.skills_checkoffs;
CREATE POLICY "skills_checkoffs select"
  ON public.skills_checkoffs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "skills_checkoffs admin write" ON public.skills_checkoffs;
CREATE POLICY "skills_checkoffs admin write"
  ON public.skills_checkoffs FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "skills_evaluators select" ON public.skills_evaluators;
CREATE POLICY "skills_evaluators select"
  ON public.skills_evaluators FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "skills_evaluators admin write" ON public.skills_evaluators;
CREATE POLICY "skills_evaluators admin write"
  ON public.skills_evaluators FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Evaluations: evaluators see all; a candidate sees their own record.
DROP POLICY IF EXISTS "skills_evaluations select" ON public.skills_evaluations;
CREATE POLICY "skills_evaluations select"
  ON public.skills_evaluations FOR SELECT
  TO authenticated
  USING (
    public.is_skills_evaluator()
    OR candidate_id = public.current_app_user_id()
  );

DROP POLICY IF EXISTS "skills_evaluations evaluator insert" ON public.skills_evaluations;
CREATE POLICY "skills_evaluations evaluator insert"
  ON public.skills_evaluations FOR INSERT
  TO authenticated
  WITH CHECK (public.is_skills_evaluator() AND NOT public.is_kiosk_user());

DROP POLICY IF EXISTS "skills_evaluations evaluator update" ON public.skills_evaluations;
CREATE POLICY "skills_evaluations evaluator update"
  ON public.skills_evaluations FOR UPDATE
  TO authenticated
  USING (public.is_skills_evaluator() AND NOT public.is_kiosk_user())
  WITH CHECK (public.is_skills_evaluator() AND NOT public.is_kiosk_user());

DROP POLICY IF EXISTS "skills_evaluations admin delete" ON public.skills_evaluations;
CREATE POLICY "skills_evaluations admin delete"
  ON public.skills_evaluations FOR DELETE
  TO authenticated
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_checkoffs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_evaluators TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_evaluations TO authenticated;
GRANT ALL ON public.skills_checkoffs TO service_role;
GRANT ALL ON public.skills_evaluators TO service_role;
GRANT ALL ON public.skills_evaluations TO service_role;

-- 5) Realtime for the live board ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'skills_evaluations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.skills_evaluations;
  END IF;
END $$;

-- 6) Seed: the six NEOP Skills Day check-offs (Candidate Guide Rev. 08/18/2026)
INSERT INTO public.skills_checkoffs (key, title, subtitle, note, sort, sections) VALUES
(
  'airway',
  'Airway',
  'Morning Rotation · Station 1',
  'Scenario covers the core airway sequence; remaining items run as quick bench demonstrations. Z Vent is a separate checklist at the same stop.',
  1,
  '[
    {"title":"Scenario core","items":[
      {"key":"airway_assessment","label":"Airway assessment performed"},
      {"key":"equipment_prep","label":"Equipment preparation"},
      {"key":"opa","label":"OPA insertion"},
      {"key":"bvm_1","label":"BVM ventilation (1-person)"},
      {"key":"bvm_2","label":"BVM ventilation (2-person)"},
      {"key":"supraglottic","label":"Supraglottic airway placement"},
      {"key":"intubation","label":"Intubation"},
      {"key":"mcgrath","label":"McGrath VL use"},
      {"key":"capnography","label":"Capnography interpretation"},
      {"key":"tube_confirmation","label":"Tube/device confirmation"},
      {"key":"cric","label":"Cricothyrotomy simulation"},
      {"key":"complications","label":"Complication recognition"}
    ]},
    {"title":"Bench demonstrations","items":[
      {"key":"npa","label":"NPA insertion"},
      {"key":"chest_decompression","label":"Chest decompression"},
      {"key":"cpap","label":"CPAP setup"},
      {"key":"documentation","label":"Documentation verbalization"}
    ]},
    {"title":"Ventilator — Zoll Z Vent","items":[
      {"key":"zvent_setup","label":"Set up the Z Vent (circuit, O2 source, power-on)"},
      {"key":"zvent_ac","label":"Set correct settings for an adult patient in AC mode"},
      {"key":"zvent_cpap","label":"Set up CPAP mode"},
      {"key":"zvent_bilevel","label":"Set up BiLevel mode"},
      {"key":"zvent_alarms","label":"Most common alarms — verbalize what to do, check, and change"}
    ]}
  ]'::jsonb
),
(
  'lp15',
  'Cardiac Monitor (LP15)',
  'Morning Rotation · Station 2',
  'Device walk-through, not a scenario. Verbalize what each control does as you use it.',
  2,
  '[
    {"title":"Setup & controls","items":[
      {"key":"power_on","label":"Power on device"},
      {"key":"alarms","label":"Silence, turn on/off, and change alarms"},
      {"key":"battery","label":"Charge battery & AC adapter"},
      {"key":"print_3lead","label":"Print 3-lead and replace paper"},
      {"key":"buttons","label":"Verbalize purpose of each button"},
      {"key":"review_print","label":"Demonstrate review/print 12-lead, code summary"},
      {"key":"display","label":"Change display & contrast"},
      {"key":"transmit_eso","label":"Transmit to ESO"}
    ]},
    {"title":"Monitoring","items":[
      {"key":"lead_placement","label":"Demonstrate proper lead placement"},
      {"key":"spo2","label":"Demonstrate SpO2"},
      {"key":"twelve_lead","label":"Perform 12-lead"},
      {"key":"etco2","label":"Demonstrate EtCO2"},
      {"key":"nibp","label":"Obtain NIBP and change time/mode"}
    ]},
    {"title":"Therapy modes","items":[
      {"key":"pad_placement","label":"Proper pad placement"},
      {"key":"defibrillation","label":"Demonstrate defibrillation"},
      {"key":"aed_mode","label":"Demonstrate using AED mode"},
      {"key":"pacing","label":"Demonstrate pacing"},
      {"key":"sync_cardioversion","label":"Demonstrate sync cardioversion"},
      {"key":"capture","label":"Explain difference between mechanical/electrical capture"}
    ]}
  ]'::jsonb
),
(
  'trauma',
  'Trauma',
  'Morning Rotation · Station 3',
  'Relay circuit of discrete stations-within-the-station. Automatic remediation triggers: failure to recognize a life threat · improper tourniquet placement · loss of spinal precautions · failure to reassess pulses after splinting · unsafe patient packaging · incorrect traction splint use · improper burn management · unsafe LUCAS placement.',
  3,
  '[
    {"title":"Relay circuit","items":[
      {"key":"primary_survey","label":"Primary trauma survey"},
      {"key":"hemorrhage","label":"Hemorrhage control"},
      {"key":"tourniquet","label":"Tourniquet application"},
      {"key":"c_collar","label":"Cervical collar sizing & placement"},
      {"key":"log_roll","label":"Log roll with spinal precautions"},
      {"key":"lsb","label":"Long spine board immobilization"},
      {"key":"scoop","label":"Scoop stretcher transfer"},
      {"key":"ked","label":"KED application"},
      {"key":"traction_splint","label":"Traction splint application"},
      {"key":"extremity_splint","label":"Extremity splinting"},
      {"key":"sam_splint","label":"SAM splint molding"},
      {"key":"burn_sheet","label":"Burn sheet application"},
      {"key":"restraints","label":"Soft restraints application"},
      {"key":"packaging","label":"Patient packaging & securing"},
      {"key":"lucas","label":"LUCAS deployment"},
      {"key":"circulation","label":"Circulation reassessment"},
      {"key":"trauma_report","label":"Trauma communication / report"}
    ]}
  ]'::jsonb
),
(
  'cardiac_skills',
  'Cardiac Skills',
  'Morning Rotation · Station 4 · First Check-Off',
  'Separate sign-off from the LP15 monitor check-off at the combined stop.',
  4,
  '[
    {"title":"Hands-on","items":[
      {"key":"manual_hr","label":"Manual heart rate"},
      {"key":"manual_bp","label":"Manual BP with MAP"},
      {"key":"heart_tones","label":"Heart tones auscultation"},
      {"key":"compressions","label":"Chest compressions"},
      {"key":"arrest_epi","label":"Epi 1:10,000 (cardiac arrest) — verbalized"}
    ]},
    {"title":"Rhythm identification","items":[
      {"key":"svt","label":"SVT"},
      {"key":"afib","label":"Atrial fibrillation"},
      {"key":"aflutter","label":"Atrial flutter"},
      {"key":"vfib","label":"Ventricular fibrillation"},
      {"key":"vtach","label":"Ventricular tachycardia"},
      {"key":"stemi","label":"Sinus rhythm (STEMI)"},
      {"key":"random_strip","label":"Random strip"}
    ]}
  ]'::jsonb
),
(
  'iv_pump',
  'Sapphire IV Pump',
  'Morning Rotation · Station 4 · Second Check-Off',
  'One direct order: set up a norepinephrine (Levophed) infusion for a septic shock patient at the weight given.',
  5,
  '[
    {"title":"Pump operation","items":[
      {"key":"power_on","label":"Power on device"},
      {"key":"battery","label":"Charge battery"},
      {"key":"mode","label":"Change to adult/pedi mode"},
      {"key":"mount","label":"Able to mount device"},
      {"key":"prime","label":"Load and prime with 100 mL NS"},
      {"key":"select_med","label":"Select medication"},
      {"key":"setup_infusion","label":"Set up a med infusion"},
      {"key":"recheck","label":"Rechecks settings prior to beginning infusion"},
      {"key":"begin","label":"Properly begins infusion"},
      {"key":"pause","label":"Properly pauses infusion"},
      {"key":"off","label":"Properly turns off device"},
      {"key":"repeat_last","label":"Demonstrates how to repeat last infusion"},
      {"key":"explain_programming","label":"Explain dose rate, VTBI, and time as programmed"}
    ]}
  ]'::jsonb
),
(
  'medication',
  'Medication',
  'Afternoon · One-on-One Slots',
  'Aseptic full draw (competency elements checked here), dose-and-draw on critical medications, then the card walk. Automatic remediation triggers: incorrect dose calculation · wrong concentration recognition · failure to label · unsafe aseptic technique · wrong route · failure to identify high-risk medications · inability to differentiate epinephrine concentrations.',
  6,
  '[
    {"title":"Competency elements","items":[
      {"key":"med_id","label":"Correct medication identification"},
      {"key":"indications","label":"Indications verbalized"},
      {"key":"contraindications","label":"Contraindications verbalized"},
      {"key":"dose_calc","label":"Dose calculation correct"},
      {"key":"concentration","label":"Concentration recognition"},
      {"key":"syringe","label":"Correct syringe selection"},
      {"key":"aseptic","label":"Aseptic draw technique"},
      {"key":"labeling","label":"Medication labeling"},
      {"key":"route","label":"Route verbalization"},
      {"key":"side_effects","label":"Side effects recognition"},
      {"key":"reassessment","label":"Reassessment verbalized"}
    ]},
    {"title":"Dose and draw — critical / high-risk","note":"List set by the CDO and may change on the day.","items":[
      {"key":"dd_epi_11000","label":"Epinephrine 1:1,000"},
      {"key":"dd_amiodarone","label":"Amiodarone"},
      {"key":"dd_mag","label":"Magnesium sulfate"},
      {"key":"dd_ketamine","label":"Ketamine"},
      {"key":"dd_push_dose_epi","label":"Push-dose epinephrine preparation"}
    ]},
    {"title":"Card walk — Analgesics / Antipyretics","items":[
      {"key":"cw_acetaminophen","label":"Acetaminophen"},
      {"key":"cw_ketorolac","label":"Ketorolac"},
      {"key":"cw_morphine","label":"Morphine"},
      {"key":"cw_fentanyl","label":"Fentanyl"},
      {"key":"cw_ketamine","label":"Ketamine"}
    ]},
    {"title":"Card walk — Cardiac / Arrhythmia","items":[
      {"key":"cw_adenosine","label":"Adenosine"},
      {"key":"cw_amiodarone","label":"Amiodarone"},
      {"key":"cw_atropine","label":"Atropine"},
      {"key":"cw_diltiazem","label":"Diltiazem"},
      {"key":"cw_labetalol","label":"Labetalol"},
      {"key":"cw_lidocaine","label":"Lidocaine"},
      {"key":"cw_lidocaine_drip","label":"Lidocaine drip"},
      {"key":"cw_mag","label":"Magnesium sulfate"},
      {"key":"cw_bicarb","label":"Sodium bicarbonate"},
      {"key":"cw_calcium","label":"Calcium chloride"},
      {"key":"cw_txa","label":"Tranexamic acid"}
    ]},
    {"title":"Card walk — Respiratory","items":[
      {"key":"cw_albuterol","label":"Albuterol"},
      {"key":"cw_duoneb","label":"DuoNeb"},
      {"key":"cw_racemic_epi","label":"Racemic epinephrine"}
    ]},
    {"title":"Card walk — Vasoactive / Hemodynamic","items":[
      {"key":"cw_dopamine","label":"Dopamine"},
      {"key":"cw_nitro_tabs","label":"Nitro tabs"},
      {"key":"cw_nitro_iv","label":"Nitroglycerin IV"},
      {"key":"cw_nicardipine","label":"Nicardipine"},
      {"key":"cw_norepi","label":"Norepinephrine"},
      {"key":"cw_nitrobid","label":"Nitrobid"}
    ]},
    {"title":"Card walk — Sedation / RSI / Neurologic","items":[
      {"key":"cw_etomidate","label":"Etomidate"},
      {"key":"cw_rocuronium","label":"Rocuronium"},
      {"key":"cw_midazolam","label":"Midazolam"},
      {"key":"cw_lorazepam","label":"Lorazepam"}
    ]},
    {"title":"Card walk — Allergic / GI","items":[
      {"key":"cw_diphenhydramine","label":"Diphenhydramine"},
      {"key":"cw_famotidine","label":"Famotidine"},
      {"key":"cw_dexamethasone","label":"Dexamethasone"},
      {"key":"cw_zofran","label":"Zofran"}
    ]},
    {"title":"Card walk — Endocrine / Metabolic","items":[
      {"key":"cw_dextrose","label":"Dextrose"},
      {"key":"cw_oral_glucose","label":"Oral glucose"},
      {"key":"cw_ns","label":"Normal saline"}
    ]}
  ]'::jsonb
)
ON CONFLICT (key) DO NOTHING;
