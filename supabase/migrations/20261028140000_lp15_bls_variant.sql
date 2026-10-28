-- LP15 BLS variant (2026-10-28, applied live, per Justin mid-skills-day):
-- basics do not test on pacing or synchronized cardioversion (and the
-- electrical-vs-mechanical capture explanation goes with pacing).
-- lp15_bls keeps the full setup/controls/monitoring sets plus pads,
-- defibrillation, and AED mode.
--
-- Today's four EMT-B trainees had already completed the FULL lp15 form
-- before this change; their signed records stand untouched and their
-- day scoping was not swapped (nothing pending). Future Skills Days
-- scope EMT-Bs to lp15_bls in Setup, like the other *_bls variants.

insert into skills_checkoffs (key, title, subtitle, note, sections, sort, active)
select 'lp15_bls', 'Cardiac Monitor (LP15) — BLS', 'Station 2 · First Check-Off · EMT-B set',
  'EMT-B monitor set: full setup, controls, and monitoring, therapy through pads, defibrillation, and AED mode. Pacing and synchronized cardioversion are medic scope and stay on the medic form.',
  '[
    {"title":"Setup & controls","items":[
      {"key":"power_on","label":"Power on device"},
      {"key":"alarms","label":"Silence, turn on/off, and change alarms"},
      {"key":"battery","label":"Charge battery & AC adapter"},
      {"key":"print_3lead","label":"Print 3-lead and replace paper"},
      {"key":"buttons","label":"Verbalize purpose of each button"},
      {"key":"review_print","label":"Demonstrate review/print 12-lead, code summary"},
      {"key":"display","label":"Change display & contrast"},
      {"key":"transmit","label":"Transmit to ESO"}]},
    {"title":"Monitoring","items":[
      {"key":"lead_placement","label":"Demonstrate proper lead placement"},
      {"key":"spo2","label":"Demonstrate SpO2"},
      {"key":"twelve_lead","label":"Perform 12-lead"},
      {"key":"etco2","label":"Demonstrate EtCO2"},
      {"key":"nibp","label":"Obtain NIBP and change time/mode"}]},
    {"title":"Therapy modes","items":[
      {"key":"pad_placement","label":"Proper pad placement"},
      {"key":"defib","label":"Demonstrate defibrillation"},
      {"key":"aed_mode","label":"Demonstrate using AED mode"}]}
  ]'::jsonb, 13, true
where not exists (select 1 from skills_checkoffs where key = 'lp15_bls');
