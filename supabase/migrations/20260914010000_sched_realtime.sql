-- Live scheduling boards: stream sched_entries + sched_requests changes
-- so open boards refresh as requests are filed and shifts change hands.
-- RLS still applies to what each subscriber receives; the client only
-- uses events as a "reload" signal anyway.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sched_entries'
  ) then
    alter publication supabase_realtime add table public.sched_entries;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sched_requests'
  ) then
    alter publication supabase_realtime add table public.sched_requests;
  end if;
end $$;
