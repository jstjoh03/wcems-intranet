-- Knowledge tests decoupled from the attestation (2026-11-02, applied
-- live). Justin: "Can we keep the video completion and the test as
-- separate? That way the video flow will not be affected."
--
-- The video → attestation flow is untouched by the test: signing no
-- longer waits on a pass. The test still unlocks only after the video
-- — and for people who ALREADY signed the attestation (45 signed the
-- protocol-updates module before the test existed), a signed
-- attestation counts as having watched, so the test opens for them
-- even where video_completed_at predates watch tracking or the row
-- was admin-marked. Both RPCs get the widened gate.

create or replace function public.rt_quiz_start(p_training_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid;
  v_done timestamptz;
  v_signed boolean;
  v_cfg jsonb;
  v_qs jsonb;
begin
  select id into v_uid from app_users where auth_user_id = auth.uid() and active;
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  select video_completed_at, attestation_signed into v_done, v_signed
  from required_training_completions
  where required_training_id = p_training_id and user_id = v_uid;
  if v_done is null and not coalesce(v_signed, false) then
    raise exception 'Finish the video first — the test unlocks when it ends.';
  end if;
  select quiz into v_cfg from required_trainings where id = p_training_id;
  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'no', q.no, 'prompt', q.prompt, 'options', q.options)
         order by q.no)
    into v_qs
  from (
    select id, prompt, options, row_number() over (order by sort, created_at) as no
    from rt_quiz_questions
    where training_id = p_training_id and active
  ) q;
  return jsonb_build_object(
    'passPct', coalesce((v_cfg->>'passPct')::int, 80),
    'questions', coalesce(v_qs, '[]'::jsonb)
  );
end
$$;
revoke all on function public.rt_quiz_start(uuid) from public, anon;
grant execute on function public.rt_quiz_start(uuid) to authenticated, service_role;

create or replace function public.rt_quiz_submit(p_training_id uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid;
  v_comp record;
  v_pass_pct int;
  v_total int := 0;
  v_correct int := 0;
  v_missed int[] := '{}';
  v_ans int;
  r record;
  v_score int;
  v_passed boolean;
begin
  select id into v_uid from app_users where auth_user_id = auth.uid() and active;
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_comp
  from required_training_completions
  where required_training_id = p_training_id and user_id = v_uid;
  if v_comp.id is null
     or (v_comp.video_completed_at is null and not coalesce(v_comp.attestation_signed, false)) then
    raise exception 'Finish the video first — the test unlocks when it ends.';
  end if;
  select coalesce((quiz->>'passPct')::int, 80) into v_pass_pct
  from required_trainings where id = p_training_id;

  for r in
    select id, correct_idx, row_number() over (order by sort, created_at) as no
    from rt_quiz_questions
    where training_id = p_training_id and active
  loop
    v_total := v_total + 1;
    v_ans := nullif(p_answers->>(r.id::text), '')::int;
    if v_ans is not null and v_ans = r.correct_idx then
      v_correct := v_correct + 1;
    else
      v_missed := v_missed || r.no::int;
    end if;
  end loop;

  if v_total = 0 then
    raise exception 'This module has no test.';
  end if;

  v_score := round(100.0 * v_correct / v_total);
  v_passed := v_score >= v_pass_pct;

  insert into rt_quiz_attempts (training_id, user_id, score_pct, passed, answers)
  values (p_training_id, v_uid, v_score, v_passed, coalesce(p_answers, '{}'::jsonb));

  if v_passed then
    update required_training_completions
    set quiz_score = v_score, updated_at = now()
    where id = v_comp.id and (quiz_score is null or quiz_score < v_score);
  end if;

  return jsonb_build_object(
    'score', v_score,
    'passed', v_passed,
    'passPct', v_pass_pct,
    'correct', v_correct,
    'total', v_total,
    'missed', case when v_passed then '[]'::jsonb else to_jsonb(v_missed) end
  );
end
$$;
revoke all on function public.rt_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function public.rt_quiz_submit(uuid, jsonb) to authenticated, service_role;
