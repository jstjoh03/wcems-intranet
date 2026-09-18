-- ═════════════════════════════════════════════════════════════════════
-- EQUIPMENT CHECK-OUT · photo uploads only under a real check-out
--
-- Evidence photos live at equipment-photos/<checkout_id>/<file>. Tighten
-- the insert policy so the first folder must be an existing check-out —
-- the bucket can't be used as general file storage. (equipment_record()
-- already refuses a photo path outside the check-out's folder.)
-- ═════════════════════════════════════════════════════════════════════

drop policy if exists "equipment-photos write" on storage.objects;
create policy "equipment-photos write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'equipment-photos'
    and not public.is_kiosk_user()
    and exists (
      select 1 from public.equipment_checkouts c
      where c.id::text = (storage.foldername(name))[1]
    )
  );
