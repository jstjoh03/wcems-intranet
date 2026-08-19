-- Add Sinus bradycardia to the Cardiac Skills rhythm-identification
-- deck (requested day-of during Skills Day).
UPDATE public.skills_checkoffs
SET sections = (
  SELECT jsonb_agg(
    CASE
      WHEN s->>'title' = 'Rhythm identification'
      THEN jsonb_set(s, '{items}', (s->'items') || '[{"key":"sinus_brady","label":"Sinus bradycardia"}]'::jsonb)
      ELSE s
    END
  )
  FROM jsonb_array_elements(sections) s
)
WHERE key = 'cardiac_skills';
