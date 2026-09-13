-- M231's AIC seat takes any AEMT or higher: AEMT, any paramedic level
-- (P1C/P1/P2/P3), or a Supervisor. Rename the rule accordingly.
alter table public.sched_seats drop constraint sched_seats_qual_rule_check;
update public.sched_seats set qual_rule = 'aemt_or_higher' where qual_rule = 'aic_or_p2';
alter table public.sched_seats add constraint sched_seats_qual_rule_check
  check (qual_rule in ('p2','aemt_or_higher','any_field','supervisor','any'));

-- carry over any stored member overrides keyed by the old rule name
update public.sched_member_settings
   set qual_overrides = (qual_overrides - 'aic_or_p2')
       || jsonb_build_object('aemt_or_higher', qual_overrides->'aic_or_p2')
 where qual_overrides ? 'aic_or_p2';
