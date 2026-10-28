-- Rhythm identification self check-off (2026-10-28, applied live).
-- Medics work the NEOP rhythm strip deck at /skills/rhythms on their
-- own login; grading happens server-side against the deck's evaluator
-- key, and a perfect run records a signed skills_evaluations row under
-- the rhythm_self check-off (evaluator_id = the trainee, evaluator
-- signature null, recorded_note says auto-graded). The rhythm
-- identification section moved out of cardiac_skills at the same time
-- (its 8 items live here now); strip images are repo assets under
-- public/skills/rhythms/.
--
-- Answer security: skills_rhythm_strips has NO grants for
-- authenticated/anon (verified) — only the SECURITY DEFINER RPCs read
-- it, and misses return strip numbers, never answers.

create table if not exists skills_rhythm_strips (
  id integer primary key,
  image_path text not null,
  answer text not null,
  label text not null,
  active boolean not null default true
);
alter table skills_rhythm_strips enable row level security;
grant all on skills_rhythm_strips to service_role;

insert into skills_rhythm_strips (id, image_path, answer, label) values
  (1, '/skills/rhythms/strip-1.jpg', 'aflutter', 'Atrial flutter (4:1 conduction)'),
  (2, '/skills/rhythms/strip-2.jpg', 'vtach', 'Ventricular tachycardia (monomorphic)'),
  (3, '/skills/rhythms/strip-3.jpg', 'sinus_brady', 'Sinus bradycardia'),
  (4, '/skills/rhythms/strip-4.jpg', 'afib', 'Atrial fibrillation'),
  (5, '/skills/rhythms/strip-5.jpg', 'svt', 'SVT (narrow complex)'),
  (6, '/skills/rhythms/strip-6.jpg', 'third_degree_block', 'Third-degree (complete) AV block'),
  (7, '/skills/rhythms/strip-7.jpg', 'stemi', 'Sinus rhythm with acute inferior STEMI'),
  (8, '/skills/rhythms/strip-8.jpg', 'vfib', 'Ventricular fibrillation (fine)')
on conflict (id) do nothing;

create or replace function skills_rhythm_quiz()
returns table (id integer, image_path text)
language sql security definer set search_path = public
as $$
  select s.id, s.image_path from skills_rhythm_strips s where s.active order by s.id;
$$;
grant execute on function skills_rhythm_quiz() to authenticated;

create or replace function skills_rhythm_submit(p_answers jsonb, p_signature text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_checkoff uuid;
  v_total int := 0;
  v_correct int := 0;
  v_missed int[] := '{}';
  v_items jsonb := '{}'::jsonb;
  r record;
  v_recorded boolean := false;
begin
  select id into v_user from app_users where auth_user_id = auth.uid() and active;
  if v_user is null then
    raise exception 'No active portal user for this login';
  end if;

  for r in select * from skills_rhythm_strips where active order by id loop
    v_total := v_total + 1;
    if coalesce(p_answers->>(r.id::text), '') = r.answer then
      v_correct := v_correct + 1;
      v_items := v_items || jsonb_build_object(
        'strip_' || r.id,
        jsonb_build_object('result', 'pass', 'label', 'Strip ' || r.id || ' — ' || r.label)
      );
    else
      v_missed := v_missed || r.id;
    end if;
  end loop;

  if v_total > 0 and v_correct = v_total then
    if p_signature is null or length(p_signature) < 50 then
      raise exception 'Signature required to record the check-off';
    end if;
    select id into v_checkoff from skills_checkoffs where key = 'rhythm_self';
    if v_checkoff is not null then
      insert into skills_evaluations
        (checkoff_id, candidate_id, evaluator_id, eval_date, items, overall,
         candidate_signature, evaluator_signature, rechecks, recorded_note)
      values
        (v_checkoff, v_user, v_user, (now() at time zone 'America/Chicago')::date,
         v_items, 'pass', p_signature, null, '[]'::jsonb,
         'Self-completed rhythm identification — auto-graded by the portal against the strip deck (all strips correct).')
      on conflict (checkoff_id, candidate_id) do nothing;
      v_recorded := true;
    end if;
  end if;

  return jsonb_build_object(
    'passed', v_total > 0 and v_correct = v_total,
    'total', v_total, 'correct', v_correct,
    'missed', to_jsonb(v_missed), 'recorded', v_recorded);
end;
$$;
grant execute on function skills_rhythm_submit(jsonb, text) to authenticated;

insert into skills_checkoffs (key, title, subtitle, note, sections, sort, active)
select 'rhythm_self', 'Rhythm Identification (Self)', 'Station 2 · Self-check on a computer',
  'Self-service: the trainee completes this at /skills/rhythms on their own login. Auto-graded against the rhythm strip deck; records only when every strip is correct, signed by the trainee.',
  '[{"title":"Rhythm strips","items":[
    {"key":"strip_1","label":"Strip 1"},{"key":"strip_2","label":"Strip 2"},
    {"key":"strip_3","label":"Strip 3"},{"key":"strip_4","label":"Strip 4"},
    {"key":"strip_5","label":"Strip 5"},{"key":"strip_6","label":"Strip 6"},
    {"key":"strip_7","label":"Strip 7"},{"key":"strip_8","label":"Strip 8"}]}]'::jsonb,
  12, true
where not exists (select 1 from skills_checkoffs where key = 'rhythm_self');
