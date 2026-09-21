-- Accelerated P2 pathway flag (FTEP Program Guide v1.0 §4): selective
-- track for experienced medics — 10 training days standard vs the
-- traditional 36. The schedule-linked timeline picks its day standards
-- from this flag.
alter table pipeline_records add column if not exists p2_accelerated boolean not null default false;
