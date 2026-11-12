-- The client has subscribed to sched_trade_offers changes since the
-- Trades board shipped, but the table was never added to the realtime
-- publication — offer activity (new offers, accepts, declines) only
-- appeared after a manual reload. sched_entries and sched_requests were
-- already published; this brings the third subscribed table in line.
-- (Applied live 2026-11-12.)
alter publication supabase_realtime add table public.sched_trade_offers;
