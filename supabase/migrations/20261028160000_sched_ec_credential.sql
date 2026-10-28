-- EC (EMT candidate) scheduler credential (2026-10-28, applied live).
-- EMT candidates carry EC until they finish field training (Justin).
--
-- · sched_credentials CHECK now admits 'EC' (manual Members-tab rows).
-- · sched_pipeline_credentials(): EMT-B certs derive EC while their
--   working phase is NEOP/FTR, EMT once past field training. Medic and
--   AEMT derivations unchanged.
-- · Client: 'EC' in INTERNAL_CREDENTIALS; excluded from the
--   any_field/any self-service sets and from the M231 any-level
--   exception — candidates are admin-scheduled only until released.
-- · The four Oct-2026 NEOP basics (Sukolics, Brewer, Bright, Castro)
--   were given manual EC rows at apply time.

alter table sched_credentials drop constraint if exists sched_credentials_credential_check;
alter table sched_credentials add constraint sched_credentials_credential_check check (credential = any (array[
  'Chief','Assistant Chief','CDO','Supervisor',
  'EC','EMT','AEMT','P1C','P1','P2','P3','P4','EMT-FTO','AEMT-FTO','P2-FTO','P3-FTO'
]::text[]));

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
      -- EMT candidates stay EC through field training (Justin, 10/28)
      when lower(coalesce(r.cert_level,'')) like '%emt%' then
        case when r.working_phase in ('NEOP','FTR') then 'EC' else 'EMT' end
      else null
    end as b
  ) base
  where public.sched_level() <> 'none'
  order by r.user_id, r.updated_at desc
$function$;
