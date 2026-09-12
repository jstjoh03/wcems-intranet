-- 'none' access level: Dr. Buzzard / board members should not see the
-- schedule at all. A 'none' grant overrides the role-derived fallback in
-- sched_level(), and read policies now exclude it server-side.
alter table public.sched_access drop constraint sched_access_level_check;
alter table public.sched_access add constraint sched_access_level_check
  check (level in ('global_admin','scheduler','none'));

drop policy "units read" on public.sched_units;
create policy "units read" on public.sched_units for select to authenticated using (public.sched_level() <> 'none');
drop policy "seats read" on public.sched_seats;
create policy "seats read" on public.sched_seats for select to authenticated using (public.sched_level() <> 'none');
drop policy "rot read" on public.sched_rotation_assignments;
create policy "rot read" on public.sched_rotation_assignments for select to authenticated using (public.sched_level() <> 'none');
drop policy "entries read" on public.sched_entries;
create policy "entries read" on public.sched_entries for select to authenticated using (public.sched_level() <> 'none');
drop policy "events read" on public.sched_events;
create policy "events read" on public.sched_events for select to authenticated using (public.sched_level() <> 'none');
drop policy "notes read" on public.sched_day_notes;
create policy "notes read" on public.sched_day_notes for select to authenticated using (public.sched_level() <> 'none');
drop policy "settings read" on public.sched_settings;
create policy "settings read" on public.sched_settings for select to authenticated using (public.sched_level() <> 'none');
drop policy "avail read" on public.sched_availability;
create policy "avail read" on public.sched_availability for select to authenticated using (public.sched_level() <> 'none');
drop policy "pages read" on public.sched_pages;
create policy "pages read" on public.sched_pages for select to authenticated using (public.sched_level() <> 'none');
drop policy "claims read" on public.sched_page_claims;
create policy "claims read" on public.sched_page_claims for select to authenticated using (public.sched_level() <> 'none');

-- uniqueness guard: one open-ended assignment per seat/platoon/date
create unique index sched_rot_unique_idx
  on public.sched_rotation_assignments(seat_id, platoon, effective_from);
