-- Clinical tracking is FT/PT field staff only (Justin, 2026-09-03).
-- app_users.employment_type can't carry the distinction (HR's sheet
-- marks some volunteers/medical-direction FT/PT), so exclusion is an
-- explicit per-record flag toggled in-app from the employee file.
alter table public.pipeline_records
  add column if not exists clinical_excluded boolean not null default false;
