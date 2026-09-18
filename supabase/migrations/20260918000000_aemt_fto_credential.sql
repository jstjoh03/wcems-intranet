-- AEMT-FTO internal credential (Justin, 2026-09-18): AEMT field training
-- officers were stuck displaying plain "AEMT". Qualifies like an AEMT
-- (aemt_or_higher seats) and joins the FTOs page-out group client-side.
alter table sched_credentials drop constraint sched_credentials_credential_check;
alter table sched_credentials add constraint sched_credentials_credential_check
  check (credential in (
    'Chief', 'Assistant Chief', 'CDO', 'Supervisor',
    'EMT', 'AEMT', 'P1C', 'P1', 'P2', 'P3', 'P4',
    'EMT-FTO', 'AEMT-FTO', 'P2-FTO', 'P3-FTO'
  ));
