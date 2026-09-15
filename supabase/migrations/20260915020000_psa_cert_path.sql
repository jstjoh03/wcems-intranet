-- ACLS / PALS precourse self-assessment: newer AHA PSAs don't show a
-- numeric score, so the roster stores the student's PSA completion
-- certificate instead — uploaded to the training-archives bucket under
-- {sessionId}/PSA/{safeEmail}/ and referenced here. psa_score stays
-- for legacy rows and any course that still keys a number.
alter table public.training_attendance
  add column psa_cert_path text;
