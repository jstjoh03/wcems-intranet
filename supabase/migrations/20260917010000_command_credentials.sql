-- Command-staff + P4 internal credentials (any-seat qualified in the
-- client's QUAL_RULE_CREDENTIALS): Chief, Assistant Chief, CDO, P4.
alter table sched_credentials drop constraint sched_credentials_credential_check;
alter table sched_credentials add constraint sched_credentials_credential_check
  check (credential in (
    'Chief', 'Assistant Chief', 'CDO', 'Supervisor',
    'EMT', 'AEMT', 'P1C', 'P1', 'P2', 'P3', 'P4',
    'EMT-FTO', 'P2-FTO', 'P3-FTO'
  ));
