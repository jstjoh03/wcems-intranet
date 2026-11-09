-- Christmas-party email RSVPs (2026-11-09). One row per (event, member);
-- the token is the whole credential on the emailed Yes/No links (same
-- model as sched_ics_feeds). The party-rsvp edge function owns all reads
-- and writes with the service role — no client access — and mirrors each
-- answer into Laurel's tracker workbook (sync_error flags a mirror that
-- failed so it can be retried by hand).
create table if not exists public.party_rsvps (
  event_key text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  token text not null unique,
  attending boolean,
  headcount int not null default 1,
  guest_names text,
  dietary text,
  sync_error boolean not null default false,
  responded_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_key, user_id)
);

alter table public.party_rsvps enable row level security;

-- GRANTs gate BEFORE RLS; hand-made tables need service_role spelled out.
grant all on public.party_rsvps to service_role;
