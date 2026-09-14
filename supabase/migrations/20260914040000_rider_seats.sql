-- Extra "rider" seats: a unit can carry additional third-rider seats
-- for a day or date range (observers, new hires in field training) —
-- "M272 runs a Paramedic and TWO Attendants this week". Rider rows are
-- unit-attached like students but claim/assign like open seats:
-- user_id null + status 'open' is an open extra seat.
alter table public.sched_entries drop constraint sched_entries_kind_check;
alter table public.sched_entries add constraint sched_entries_kind_check
  check (kind in ('rotation','pickup','trade','giveaway_cover','extra','event','student','timeoff','rider'));
