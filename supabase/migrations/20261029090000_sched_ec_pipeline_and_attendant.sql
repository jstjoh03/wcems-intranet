-- EC credential: pipeline-owned + attendant self-service (2026-10-29, applied live).
-- Justin: "The ECs do need the training pipeline and also they should
-- be able to request attendant spots." Two reversals of 10/28:
--
-- · sched_pipeline_credentials(): an EMT-B is EC until their pipeline
--   record is cleared at FinalRelease — no phase bookkeeping needed.
--   The 10/28 rule keyed on working_phase NEOP/FTR, but the Oct cohort's
--   rows (and most pending rows) carry NULL phases, which derived EMT.
--   Now a new EMT-B hire is EC from the day their pipeline row exists,
--   and flips to EMT automatically at Final Release.
-- · The four manual EC rows from 10/28 (Sukolics, Brewer, Bright,
--   Castro) are deleted — the pipeline derivation takes over.
-- · Client (useSchedule.ts): EC restored to the any_field/any seat sets,
--   so ECs can self-request Attendant spots. Still barred from p2 /
--   aemt_or_higher / supervisor seats and from the M231 any-level
--   exception until released.

create or replace function public.sched_pipeline_credentials()
returns table(user_id uuid, credential text)
language sql stable security definer set search_path to 'public'
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
      -- EMT candidates are EC until the pipeline clears them at Final
      -- Release (Justin, 10/29) — pending/unphased rows included
      when lower(coalesce(r.cert_level,'')) like '%emt%' then
        case when r.cleared_phase = 'FinalRelease' then 'EMT' else 'EC' end
      else null
    end as b
  ) base
  where public.sched_level() <> 'none'
  order by r.user_id, r.updated_at desc
$function$;

-- One-time: hand the four 10/28 manual EC rows back to the derivation.
delete from sched_credentials
where credential = 'EC'
  and user_id in (
    '87d2a3e6-ecdc-4bfe-88e2-e54f9d5f49fe', -- Sukolics
    'f3894472-7c50-4772-8082-270b301468bf', -- Brewer
    '5fc4d8b9-63ff-42cf-a32b-16cb6c77a2ac', -- Bright
    '9314dbae-7357-487f-a63f-7549218ff8c2'  -- Castro
  );
