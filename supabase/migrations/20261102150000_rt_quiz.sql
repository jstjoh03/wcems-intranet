-- Required Training knowledge tests (2026-11-02, applied live).
-- Justin: "We need to create a test for the protocol updates that every
-- employee will take once they watch the training video."
--
-- Questions live SERVER-SIDE like the rhythm-quiz answer key: the
-- rt_quiz_questions table is admin-only under RLS, and crew reach the
-- questions (sans answers) and grading only through SECURITY DEFINER
-- RPCs. rt_quiz_submit requires the completion row to carry
-- video_completed_at, so the video gate is enforced on the server too.
-- A passing score lands in required_training_completions.quiz_score
-- (the column has existed since the module shipped) which the detail
-- view uses to unlock the attestation.
--
-- Module config rides in required_trainings.quiz jsonb:
--   { "passPct": 80, "count": 15 }  (display metadata — no answers).
-- Seeded here: the 15-question Q4 2026 Protocol Updates test, written
-- from the training deck the video narrates (Book rev3 FINAL /
-- "Protocol Updates 2026 training deck.pptx", 39 slides).

create table if not exists rt_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references required_trainings(id) on delete cascade,
  sort integer not null default 0,
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_idx integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rt_quiz_questions_training_idx on rt_quiz_questions (training_id, sort);
alter table rt_quiz_questions enable row level security;
drop policy if exists "rt quiz questions admin" on rt_quiz_questions;
create policy "rt quiz questions admin" on rt_quiz_questions
  for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on rt_quiz_questions to authenticated;
grant all on rt_quiz_questions to service_role;

create table if not exists rt_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references required_trainings(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  score_pct integer not null,
  passed boolean not null,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists rt_quiz_attempts_training_user_idx on rt_quiz_attempts (training_id, user_id);
alter table rt_quiz_attempts enable row level security;
drop policy if exists "rt quiz attempts read" on rt_quiz_attempts;
create policy "rt quiz attempts read" on rt_quiz_attempts
  for select using (
    is_admin() or user_id = (select id from app_users where auth_user_id = auth.uid())
  );
grant select on rt_quiz_attempts to authenticated;
grant all on rt_quiz_attempts to service_role;

-- Questions for the signed-in crew member: numbered, no answer key.
-- Requires the module's video to be finished (server-enforced).
create or replace function public.rt_quiz_start(p_training_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid;
  v_done timestamptz;
  v_cfg jsonb;
  v_qs jsonb;
begin
  select id into v_uid from app_users where auth_user_id = auth.uid() and active;
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;
  select video_completed_at into v_done
  from required_training_completions
  where required_training_id = p_training_id and user_id = v_uid;
  if v_done is null then
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

-- Grade server-side: records the attempt, stamps quiz_score on the
-- completion row on a pass, and returns missed QUESTION NUMBERS only —
-- never the answers.
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
  if v_comp.id is null or v_comp.video_completed_at is null then
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

-- ── Seed: Q4 2026 Protocol Updates test (module 759ed20f…) ───────────
-- 15 questions across all certification bands, written from the deck
-- the video narrates. Pass mark 80% (12 of 15) — editable in Manage
-- Required Training.
delete from rt_quiz_questions where training_id = '759ed20f-dff6-4885-96ce-838a8e22e542';
insert into rt_quiz_questions (training_id, sort, prompt, options, correct_idx) values
('759ed20f-dff6-4885-96ce-838a8e22e542', 10,
 'In the 2026 book, which section was renumbered?',
 '["Section 2 — Treatment Protocols", "Section 1 — Procedures & Directives (Section 2 numbers did not change)", "Both sections", "Neither — only the cover changed"]', 1),
('759ed20f-dff6-4885-96ce-838a8e22e542', 20,
 'On a protocol page, orders printed in red below the MEDICAL CONTROL bar are…',
 '["Standing orders you perform without contact", "Optional comfort-care orders", "Orders that require an on-line Medical Control order", "Orders for the next certification level up"]', 2),
('759ed20f-dff6-4885-96ce-838a8e22e542', 30,
 'Cefazolin (Ancef) is new to the 2026 protocols. Who gives it, and for what?',
 '["Paramedic — open fractures and open traumatic wounds, including amputation, if time permits", "Advanced EMT — any laceration needing stitches", "Paramedic — all burns", "EMT — abrasions and road rash"]', 0),
('759ed20f-dff6-4885-96ce-838a8e22e542', 40,
 'The adult cefazolin dose is…',
 '["500 mg IV — half a vial", "1 g IV/IO — one vial", "2 g IV/IO — two 1 g vials, each mixed with 10 mL Normal Saline", "4 g IM"]', 2),
('759ed20f-dff6-4885-96ce-838a8e22e542', 50,
 'EMTs may now give acetaminophen. Which statement is correct?',
 '["By mouth — adult 1000 mg for fever or minor pain (<4/10)", "By IV infusion over 15 minutes", "Only with a Medical Control order", "Only for pediatric patients"]', 0),
('759ed20f-dff6-4885-96ce-838a8e22e542', 60,
 'Acetaminophen must NOT be given when…',
 '["The patient is over 65", "A correct dose was given within the last 4 hours, or the patient has known liver disease", "The patient also received ibuprofen today", "The SBP is under 140"]', 1),
('759ed20f-dff6-4885-96ce-838a8e22e542', 70,
 'Naloxone is now in the EMT band. The adult dose is…',
 '["2 mg IM every 10 minutes", "0.5–1 mg intranasal, may repeat every 2–5 minutes", "4 mg IV push once", "0.1 mg/kg IN, max 10 mg"]', 1),
('759ed20f-dff6-4885-96ce-838a8e22e542', 80,
 'EMT CPAP in cardiogenic shock (2.16) is allowed only when…',
 '["The patient is intubated", "A paramedic is on scene", "There is pulmonary edema AND the SBP is 90 or above — standalone CPAP only", "The transport time is under 10 minutes"]', 2),
('759ed20f-dff6-4885-96ce-838a8e22e542', 90,
 'An Advanced EMT acquires and transmits a 12-lead ECG. Who may interpret it?',
 '["The AEMT who acquired it", "Any crew member with ACLS", "A paramedic or physician only — and before any nitroglycerin, one of them must have read it", "The LIFEPAK''s automated statement is sufficient"]', 2),
('759ed20f-dff6-4885-96ce-838a8e22e542', 100,
 'Advanced EMTs now give epinephrine in cardiac arrest. The adult dose is…',
 '["1 mg of 1:1,000 IM every 5 minutes", "1 mg of 1:10,000 IVP/IO every 5 minutes", "0.5 mg of 1:10,000 IVP every 3 minutes", "10 mcg push-dose every 2 minutes"]', 1),
('759ed20f-dff6-4885-96ce-838a8e22e542', 110,
 'Which two medications moved to the Advanced EMT level in 2026?',
 '["Ketorolac and fentanyl", "Droperidol and midazolam", "Ondansetron, and diphenhydramine IV/IO/IM", "Amiodarone and adenosine"]', 2),
('759ed20f-dff6-4885-96ce-838a8e22e542', 120,
 'Push-dose norepinephrine is mixed…',
 '["As its own 10 mL dilution, 1 mg in 9 mL NS", "From the infusion bag — 4 mg in 250 mL D5W (16 mcg/mL); draw 1 mL and give 0.25–1 mL (4–16 mcg) every 2–5 minutes", "From the 1:10,000 arrest syringe", "It is never push-dosed — infusion only"]', 1),
('759ed20f-dff6-4885-96ce-838a8e22e542', 130,
 'Adult defibrillation and unstable A-fib/flutter cardioversion energies now step…',
 '["125 → 150 → 200 J, as before", "150 J for every shock", "200 → 300 → 360 J (AHA 2025 / LIFEPAK 15)", "360 J for every shock"]', 2),
('759ed20f-dff6-4885-96ce-838a8e22e542', 140,
 'In 2.41 Pulmonary Edema, nitroglycerin starts at SBP ____ or above, and if the SBP falls below ____ the paste comes off and the infusion stops.',
 '["120 / 100", "140 / 110", "160 / 120", "100 / 90"]', 1),
('759ed20f-dff6-4885-96ce-838a8e22e542', 150,
 'Needle cricothyrotomy (1.16) is a new paramedic procedure for…',
 '["Any failed airway at any age", "Adults when intubation fails twice", "A child under 12 when all other airway means have failed — 12 and older goes to 1.17 Surgical Cricothyrotomy", "Suspected epiglottitis only"]', 2);

update required_trainings
set quiz = '{"passPct": 80, "count": 15}'::jsonb
where id = '759ed20f-dff6-4885-96ce-838a8e22e542';
