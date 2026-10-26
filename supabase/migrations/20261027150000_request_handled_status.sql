-- "Already handled" is not an approval (Riann's false APPROVED push,
-- 2026-10-27): give it its own terminal status and reclassify every
-- request historically closed that way — identified exactly by the
-- request.handled audit action — so the Requests tab stops labeling
-- them Approved. (Applied live 2026-10-27; 120 rows reclassified.)

alter table public.sched_requests drop constraint if exists sched_requests_status_check;
alter table public.sched_requests add constraint sched_requests_status_check
  check (status = any (array['pending'::text, 'partner_accepted'::text, 'approved'::text,
                             'denied'::text, 'cancelled'::text, 'handled'::text]));

update public.sched_requests r
   set status = 'handled'
 where r.status = 'approved'
   and exists (
     select 1 from public.sched_audit a
     where a.action = 'request.handled' and a.entity_id = r.id::text
   )
   -- safety: never reclassify a request that actually produced schedule rows
   and not exists (
     select 1 from public.sched_entries e where e.source_request = r.id
   );
