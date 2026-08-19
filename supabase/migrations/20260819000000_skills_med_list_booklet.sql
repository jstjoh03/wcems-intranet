-- ─────────────────────────────────────────────────────────────────────
-- skills_med_list_booklet
--
-- Sync the Medication check-off card walk to "Medication Booklet 2026
-- - updated" (the current formulary, 36 cards). Changes vs the seed:
--   + Aspirin, Epinephrine, Droperidol, Naloxone (Narcan)
--   ~ DuoNeb → Ipratropium bromide (Atrovent)  (booklet card name)
--   ~ Nitro tabs / Nitroglycerin IV / Nitrobid → one card,
--     "Nitroglycerin (tablet, paste & IV)" — matches the booklet's
--     single card covering all three forms
--   ~ Lidocaine drip merged into Lidocaine (no separate booklet card)
--   ~ Normal saline → Lactated Ringers (the booklet's fluid card)
--   ~ Morphine → Morphine sulfate
--   − Famotidine (not in the booklet)
-- Competency elements and the dose-and-draw list are unchanged.
-- ─────────────────────────────────────────────────────────────────────

UPDATE public.skills_checkoffs
SET sections = '[
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
    {"key":"cw_morphine","label":"Morphine sulfate"},
    {"key":"cw_fentanyl","label":"Fentanyl"},
    {"key":"cw_ketamine","label":"Ketamine"}
  ]},
  {"title":"Card walk — Cardiac / Arrhythmia","items":[
    {"key":"cw_adenosine","label":"Adenosine"},
    {"key":"cw_amiodarone","label":"Amiodarone"},
    {"key":"cw_aspirin","label":"Aspirin"},
    {"key":"cw_atropine","label":"Atropine"},
    {"key":"cw_diltiazem","label":"Diltiazem"},
    {"key":"cw_epinephrine","label":"Epinephrine"},
    {"key":"cw_labetalol","label":"Labetalol"},
    {"key":"cw_lidocaine","label":"Lidocaine"},
    {"key":"cw_mag","label":"Magnesium sulfate"},
    {"key":"cw_bicarb","label":"Sodium bicarbonate"},
    {"key":"cw_calcium","label":"Calcium chloride"},
    {"key":"cw_txa","label":"Tranexamic acid"}
  ]},
  {"title":"Card walk — Respiratory","items":[
    {"key":"cw_albuterol","label":"Albuterol"},
    {"key":"cw_ipratropium","label":"Ipratropium bromide (Atrovent)"},
    {"key":"cw_racemic_epi","label":"Racemic epinephrine"}
  ]},
  {"title":"Card walk — Vasoactive / Hemodynamic","items":[
    {"key":"cw_dopamine","label":"Dopamine"},
    {"key":"cw_nitroglycerin","label":"Nitroglycerin (tablet, paste & IV)"},
    {"key":"cw_nicardipine","label":"Nicardipine"},
    {"key":"cw_norepi","label":"Norepinephrine"}
  ]},
  {"title":"Card walk — Sedation / RSI / Neurologic","items":[
    {"key":"cw_etomidate","label":"Etomidate"},
    {"key":"cw_rocuronium","label":"Rocuronium"},
    {"key":"cw_midazolam","label":"Midazolam"},
    {"key":"cw_lorazepam","label":"Lorazepam"},
    {"key":"cw_droperidol","label":"Droperidol"},
    {"key":"cw_naloxone","label":"Naloxone (Narcan)"}
  ]},
  {"title":"Card walk — Allergic / GI","items":[
    {"key":"cw_diphenhydramine","label":"Diphenhydramine"},
    {"key":"cw_dexamethasone","label":"Dexamethasone"},
    {"key":"cw_zofran","label":"Ondansetron (Zofran)"}
  ]},
  {"title":"Card walk — Endocrine / Metabolic / Fluids","items":[
    {"key":"cw_dextrose","label":"Dextrose"},
    {"key":"cw_oral_glucose","label":"Oral glucose"},
    {"key":"cw_lr","label":"Lactated Ringers"}
  ]}
]'::jsonb
WHERE key = 'medication';
