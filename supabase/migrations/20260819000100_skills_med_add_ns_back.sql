-- Service carries both fluids: Normal saline returns alongside
-- Lactated Ringers in the medication card walk (same cw_ns key the
-- original seed used). Card walk is now 37 items — booklet's 36 cards
-- plus NS, which the booklet references but doesn't card.
UPDATE public.skills_checkoffs
SET sections = (
  SELECT jsonb_agg(
    CASE
      WHEN s->>'title' = 'Card walk — Endocrine / Metabolic / Fluids'
      THEN jsonb_set(s, '{items}', (s->'items') || '[{"key":"cw_ns","label":"Normal saline"}]'::jsonb)
      ELSE s
    END
  )
  FROM jsonb_array_elements(sections) s
)
WHERE key = 'medication';
