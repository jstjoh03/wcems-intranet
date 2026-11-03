-- One FTEP draft per evaluator+trainee+kind (2026-11-02, applied live).
-- Joe Diaz's tablet queued ~20 autosaves while its connection was
-- stalled; they all dispatched before the first insert returned an id,
-- so every one INSERTED a fresh draft (23 rows within 190 ms), and the
-- "resume my draft" logic then surfaced the orphans as the next ICR —
-- he re-submitted the same call three times. The client autosave is now
-- serialized; this index is the backstop that makes the stampede
-- impossible at the database (the client adopts the existing draft on
-- a 23505).
--
-- Cleanup performed with this migration:
-- · deleted the 2 duplicate SUBMITTED Ibarra ICRs (kept the earliest,
--   14b8f10e), · deleted the orphan drafts (20 Ibarra + 19 Dennis Ho).

-- Dedupe any remaining multi-drafts (keep the newest per key).
delete from ftep_reports r
using ftep_reports newer
where r.status = 'draft'
  and newer.status = 'draft'
  and newer.evaluator_id = r.evaluator_id
  and newer.trainee_id = r.trainee_id
  and newer.kind = r.kind
  and (newer.updated_at > r.updated_at
       or (newer.updated_at = r.updated_at and newer.id > r.id));

create unique index if not exists ftep_reports_one_draft_idx
  on ftep_reports (evaluator_id, trainee_id, kind)
  where status = 'draft';
