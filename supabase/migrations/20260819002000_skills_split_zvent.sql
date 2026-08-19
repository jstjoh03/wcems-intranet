-- Z Vent ran (or may run) separately from the rest of Airway on the
-- day — make it its own check-off so it can be signed independently.
-- No airway evaluations existed at split time, so no record surgery.
UPDATE public.skills_checkoffs SET sort = sort + 1 WHERE sort >= 2;

INSERT INTO public.skills_checkoffs (key, title, subtitle, note, sort, sections) VALUES (
  'zvent',
  'Ventilator — Zoll Z Vent',
  'Morning Rotation · Station 1 · Separate Check-Off',
  'May be completed with the airway stop or on its own.',
  2,
  '[
    {"title":"Z Vent","items":[
      {"key":"zvent_setup","label":"Set up the Z Vent (circuit, O2 source, power-on)"},
      {"key":"zvent_ac","label":"Set correct settings for an adult patient in AC mode"},
      {"key":"zvent_cpap","label":"Set up CPAP mode"},
      {"key":"zvent_bilevel","label":"Set up BiLevel mode"},
      {"key":"zvent_alarms","label":"Most common alarms — verbalize what to do, check, and change"}
    ]}
  ]'::jsonb
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.skills_checkoffs
SET sections = (
  SELECT jsonb_agg(s)
  FROM jsonb_array_elements(sections) s
  WHERE s->>'title' <> 'Ventilator — Zoll Z Vent'
),
    note = 'Scenario covers the core airway sequence; remaining items run as quick bench demonstrations. The Z Vent is now its own separate check-off.'
WHERE key = 'airway';
