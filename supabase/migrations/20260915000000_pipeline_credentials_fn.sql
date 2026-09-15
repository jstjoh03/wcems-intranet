-- Internal scheduling credentials auto-tracked from the clinical
-- pipeline. Crew can only read their OWN pipeline_records row (that
-- module's RLS), but everyone in the scheduling module sees credential
-- suffixes on the boards — so the derivation runs here as SECURITY
-- DEFINER and exposes only (user_id, derived credential) to module
-- users. An explicit sched_credentials row still overrides this in the
-- app; this is the "Auto" default.
--
-- Mapping notes (agreed with live data 2026-09-15):
--   · level (hand-kept agency designation) parses first: P1C/P1/P2/P3/
--     P4/ADV/EMT/FTO. A cleared P2 phase bumps a stale P1/P1C level —
--     clearing P2 gates IS the in-charge clearance.
--   · cleared_phase P3 = completed FTO process → P3 / P3-FTO.
--   · No usable level: fall to the phase ladder + state cert
--     (EMT-P/LP = medic track; FinalRelease with no level = released P2).
--   · is_fto suffixes EMT/P2/P3 (no AEMT-FTO credential exists).
create or replace function public.sched_pipeline_credentials()
returns table (user_id uuid, credential text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (r.user_id)
    r.user_id,
    case
      when r.cleared_phase = 'P3' then
        case when r.is_fto then 'P3-FTO' else 'P3' end
      when base.b is null then null
      when r.is_fto and base.b in ('EMT', 'P2', 'P3') then base.b || '-FTO'
      else base.b
    end as credential
  from public.pipeline_records r
  cross join lateral (
    select lower(coalesce(r.level, '')) as lvl,
           lower(coalesce(r.cert_level, '')) as cert
  ) norm
  cross join lateral (
    select case
      when norm.lvl like '%p1c%' then
        case when r.cleared_phase = 'P2' then 'P2' else 'P1C' end
      when norm.lvl like '%p3%' then 'P3'
      when norm.lvl like '%p2%' then 'P2'
      when norm.lvl like '%p1%' then
        case when r.cleared_phase = 'P2' then 'P2' else 'P1' end
      when norm.lvl like '%p4%' then 'Supervisor'
      when norm.lvl like '%adv%' then 'AEMT'
      when norm.lvl like '%emt%' then 'EMT'
      when norm.lvl like '%fto%' then
        case when norm.cert in ('emt-p', 'lp') then 'P2'
             when norm.cert like '%adv%' then 'AEMT'
             else 'EMT' end
      when norm.cert in ('emt-p', 'lp') then
        case when r.cleared_phase in ('P2', 'FinalRelease') then 'P2'
             when r.cleared_phase = 'P1' then 'P1'
             else 'P1C' end
      when norm.cert like '%adv%' then 'AEMT'
      when norm.cert like '%emt%' then 'EMT'
      else null
    end as b
  ) base
  where public.sched_level() <> 'none'
  order by r.user_id, r.updated_at desc
$$;

revoke all on function public.sched_pipeline_credentials() from public, anon;
grant execute on function public.sched_pipeline_credentials() to authenticated, service_role;
