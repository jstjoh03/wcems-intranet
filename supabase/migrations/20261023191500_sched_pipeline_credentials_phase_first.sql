-- Scheduling credential now derives PHASE-FIRST from clinical development
-- (working_phase/cleared_phase), so advancing someone in the clinical
-- console updates their scheduling credential on the next load. The old
-- version trusted the hand-typed pipeline `level` text first, which went
-- stale (credentialed P1s still derived as P1C; a cleared LP stuck at P1).
-- Also fixed: AEMT FTOs now derive AEMT-FTO (was impossible before).
-- Manual rows in sched_credentials still override everything.
create or replace function public.sched_pipeline_credentials()
 returns table(user_id uuid, credential text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select distinct on (r.user_id)
    r.user_id,
    case
      -- P4 / supervisor track is a level concept, not a phase one
      when lower(coalesce(r.level,'')) like '%p4%' then 'Supervisor'
      when base.b is null then null
      when r.is_fto and base.b in ('EMT','AEMT','P2','P3') then base.b || '-FTO'
      else base.b
    end as credential
  from public.pipeline_records r
  cross join lateral (
    select case
      -- medics: operating credential from the live clinical phases
      when lower(coalesce(r.cert_level,'')) in ('emt-p','lp') then
        case
          when r.cleared_phase = 'P3' then 'P3'
          when r.working_phase = 'P2' then 'P1'
          when r.working_phase = 'P3' then 'P2'
          when r.working_phase in ('NEOP','FTR','P1') then 'P1C'
          when r.cleared_phase in ('P2','FinalRelease') then 'P2'
          when r.cleared_phase = 'P1' then 'P1'
          else 'P1C'
        end
      when lower(coalesce(r.cert_level,'')) like '%adv%' then 'AEMT'
      when lower(coalesce(r.cert_level,'')) like '%emt%' then 'EMT'
      else null
    end as b
  ) base
  where public.sched_level() <> 'none'
  order by r.user_id, r.updated_at desc
$function$;
