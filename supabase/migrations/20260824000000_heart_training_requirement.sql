-- HEART Training joins the compliance catalog as a per-licensure-cycle
-- requirement for every field level (Justin, 2026-08-24). Like TX
-- jurisprudence it renders as a "required before <license expiry>" tag
-- and only goes DUE inside the final 6 months of the license — that
-- window logic lives app-side in pipelineGates.cycleItemStatus().
insert into public.pipeline_requirements (name, cycle, required_levels, active, notes)
select
  'HEART Training',
  'per_cert_cycle',
  array['EMT-B', 'ADV EMT', 'EMT-P', 'LP'],
  true,
  'Once per 4-year licensure cycle; due window opens 6 months before license expiry.'
where not exists (
  select 1 from public.pipeline_requirements where lower(name) = 'heart training'
);
