-- Applied 2026-08-11 via Supabase MCP (spotlight_story_and_comments).
-- Full-story field on spotlights + congratulations thread table.

alter table public.spotlights add column if not exists story text;

create table public.spotlight_comments (
  id uuid primary key default gen_random_uuid(),
  spotlight_id uuid not null references public.spotlights(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index spotlight_comments_spotlight_idx
  on public.spotlight_comments (spotlight_id, created_at);

alter table public.spotlight_comments enable row level security;

create policy "spotlight comments readable by authenticated"
  on public.spotlight_comments for select to authenticated
  using (true);

create policy "post own spotlight comments"
  on public.spotlight_comments for insert to authenticated
  with check (user_id = auth.uid());

create policy "delete own spotlight comments or admin"
  on public.spotlight_comments for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.app_users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- RLS controls WHICH rows; GRANT controls WHICH operations.
grant select, insert, delete on table public.spotlight_comments to authenticated;
