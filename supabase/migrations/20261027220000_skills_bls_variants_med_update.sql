-- NEOP Skills Day catalog update (2026-10-27), applied live via MCP.
-- Record only — the Setup tab's requirements editor owns this data
-- in-app; guards keep a re-run from clobbering later edits.
--
-- 1. Medication check-off shortened for the Oct 2026 NEOP class per
--    the CDO: dose-and-draw gains Cefazolin + push-dose norepi (the
--    2026 protocol additions), the 37-med card walk becomes 12
--    (two per class, error-prone first; duo-neb dropped). Historical
--    evaluations keep their per-item snapshots (items jsonb stores
--    labels; the packet PDF falls back to them).
-- 2. Four BLS variants added so EMT-B trainees get an all-items form
--    (the runner requires every item marked): airway_bls (no
--    intubation/VL/cric), zvent_bls + iv_pump_bls (assembly &
--    verification, not operation), medication_bls (EMT-B med set incl.
--    the 2026 protocol additions).
--
-- The guarded insert below mirrors the live rows; see the live
-- skills_checkoffs table for the authoritative sections.

insert into skills_checkoffs (key, title, subtitle, note, sections, sort, active)
select v.key, v.title, v.subtitle, v.note, v.sections::jsonb, v.sort, true
from (values
  ('airway_bls', 'Airway (BLS)', 'Station 1 · EMT-B set',
   'BLS airway set — intubation, video laryngoscopy, and cric stay with the medic form.',
   '[{"title":"Scenario core","items":[
      {"key":"airway_assessment","label":"Airway assessment performed"},
      {"key":"equipment_prep","label":"Equipment preparation"},
      {"key":"opa","label":"OPA insertion"},
      {"key":"npa","label":"NPA insertion"},
      {"key":"bvm_1","label":"BVM ventilation (1-person)"},
      {"key":"bvm_2","label":"BVM ventilation (2-person)"},
      {"key":"supraglottic","label":"Supraglottic airway placement"},
      {"key":"tube_confirmation","label":"Device confirmation"},
      {"key":"complications","label":"Complication recognition"}]},
    {"title":"Bench demonstrations","items":[
      {"key":"cpap","label":"CPAP setup"},
      {"key":"suction","label":"Suction setup and use"},
      {"key":"documentation","label":"Documentation verbalization"}]}]', 8),
  ('zvent_bls', 'Z Vent (BLS) — Assembly & Verification', 'Station 1 · EMT-B set',
   'Basics assemble and verify the vent; settings and modes are medic scope.',
   '[{"title":"Assembly & verification","items":[
      {"key":"zb_gather","label":"Gather circuit, filter, and O2 line"},
      {"key":"zb_connect","label":"Connect circuit to vent and O2 source"},
      {"key":"zb_verify","label":"Verify all pieces present and intact"},
      {"key":"zb_power","label":"Power-on test and battery check"},
      {"key":"zb_alarms","label":"Alarm awareness — what to check, who to call"}]}]', 9),
  ('iv_pump_bls', 'Sapphire IV Pump (BLS) — Assembly & Verification', 'Station 4 · EMT-B set',
   'Basics assemble and verify the pump; programming infusions is medic scope.',
   '[{"title":"Assembly & verification","items":[
      {"key":"pb_power","label":"Power on device and battery check"},
      {"key":"pb_mount","label":"Mount the device"},
      {"key":"pb_load","label":"Load a pump set"},
      {"key":"pb_prime","label":"Prime with 100 mL NS"},
      {"key":"pb_verify","label":"Verify set pieces present and clamps correct"},
      {"key":"pb_stow","label":"Power off and stow"}]}]', 10),
  ('medication_bls', 'Medication (BLS)', 'Afternoon · One-on-One Slots · EMT-B set',
   'EMT-B medication set, including the 2026 protocol additions.',
   '[{"title":"Competency elements","items":[
      {"key":"med_id","label":"Correct medication identification"},
      {"key":"indications","label":"Indications verbalized"},
      {"key":"contraindications","label":"Contraindications verbalized"},
      {"key":"dose_route","label":"Dose and route verbalized"},
      {"key":"side_effects","label":"Side effects recognition"},
      {"key":"reassessment","label":"Reassessment verbalized"}]},
    {"title":"BLS medications","items":[
      {"key":"b_oral_glucose","label":"Oral glucose"},
      {"key":"b_aspirin","label":"Aspirin"},
      {"key":"b_apap","label":"Acetaminophen PO"},
      {"key":"b_naloxone_in","label":"Naloxone IN"},
      {"key":"b_albuterol","label":"Albuterol"},
      {"key":"b_epi_im","label":"Epinephrine 1:1,000 IM (anaphylaxis)"}]}]', 11)
) as v(key, title, subtitle, note, sections, sort)
where not exists (select 1 from skills_checkoffs c where c.key = v.key);
