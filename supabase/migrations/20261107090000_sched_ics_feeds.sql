-- Personal iCal feed tokens (2026-11-07) — the sched-ics edge function
-- serves each member's shifts as an iCalendar subscription that Google /
-- Apple / Outlook refresh on their own. Calendar apps fetch with no auth
-- headers, so the token IS the credential: long, random, per-member, and
-- rotatable from the portal ("Reset link").
create table if not exists public.sched_ics_feeds (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_fetched_at timestamptz
);

alter table public.sched_ics_feeds enable row level security;

-- GRANTs gate BEFORE RLS. The edge function reads by token with the
-- service role (hand-made tables need that grant spelled out); members
-- read only their own row (the settings UI shows the link). All writes
-- go through the definer RPC below.
grant select on public.sched_ics_feeds to authenticated;
grant all on public.sched_ics_feeds to service_role;

create policy sched_ics_feeds_own_select on public.sched_ics_feeds
  for select to authenticated
  using (
    user_id in (
      select id from public.app_users where auth_user_id = (select auth.uid())
    )
  );

-- Get-or-create (p_rotate false) or rotate (true) the caller's token.
-- Kiosk accounts have no personal schedule and are refused.
create or replace function public.sched_ics_feed_token(p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_token text;
begin
  select id into v_user
  from app_users
  where auth_user_id = auth.uid()
    and active = true
    and coalesce(account_type, 'person') = 'person';
  if v_user is null then
    raise exception 'Calendar sync needs a personal portal account.';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into sched_ics_feeds (user_id, token)
  values (v_user, v_token)
  on conflict (user_id) do update
    set token = case when p_rotate then excluded.token else sched_ics_feeds.token end,
        rotated_at = case when p_rotate then now() else sched_ics_feeds.rotated_at end
  returning token into v_token;

  return v_token;
end;
$$;

revoke execute on function public.sched_ics_feed_token(boolean) from public, anon;
grant execute on function public.sched_ics_feed_token(boolean) to authenticated, service_role;
