-- Pay periods are Sunday-Saturday biweekly: Aug 30 - Sep 12, Sep 13 - 26.
update public.sched_settings
   set value = jsonb_set(value, '{period_anchor}', '"2026-08-30"')
 where key = 'pay';

-- Swap offers need a counter-shift on the request itself once accepted.
alter table public.sched_requests
  add column counter_seat_id uuid references public.sched_seats(id) on delete set null,
  add column counter_work_date date,
  add column counter_start_at timestamptz,
  add column counter_end_at timestamptz;

-- Offers on a giveaway/swap posting: a claim (no counter shift) or a
-- proposed swap shift. Poster accepts one; Chief still approves.
create table public.sched_trade_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sched_requests(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  offer_seat_id uuid references public.sched_seats(id) on delete set null,
  offer_work_date date,
  offer_start_at timestamptz,
  offer_end_at timestamptz,
  note text,
  status text not null default 'queued' check (status in ('queued','accepted','declined','withdrawn')),
  created_at timestamptz not null default now(),
  unique (request_id, user_id)
);
create index sched_trade_offers_req_idx on public.sched_trade_offers(request_id, created_at);

alter table public.sched_trade_offers enable row level security;

-- Trade/giveaway POSTINGS are a public board (that is the point);
-- time-off and extra-hours requests stay private to requester/supers.
drop policy "requests read" on public.sched_requests;
create policy "requests read" on public.sched_requests for select to authenticated
  using (
    public.sched_can_edit()
    or public.sched_level() = 'supervisor'
    or requester_id = public.current_app_user_id()
    or counterparty_id = public.current_app_user_id()
    or (type in ('giveaway','trade') and public.sched_level() <> 'none')
  );

create policy "offers read" on public.sched_trade_offers for select to authenticated
  using (
    public.sched_can_edit()
    or public.sched_level() = 'supervisor'
    or user_id = public.current_app_user_id()
    or exists (select 1 from public.sched_requests r
                where r.id = request_id and r.requester_id = public.current_app_user_id())
  );
create policy "offers insert own" on public.sched_trade_offers for insert to authenticated
  with check (user_id = public.current_app_user_id() or public.sched_can_edit());
create policy "offers update" on public.sched_trade_offers for update to authenticated
  using (
    public.sched_can_edit()
    or user_id = public.current_app_user_id()
    or exists (select 1 from public.sched_requests r
                where r.id = request_id and r.requester_id = public.current_app_user_id())
  )
  with check (true);

grant all on public.sched_trade_offers to authenticated;
grant all on public.sched_trade_offers to service_role;
