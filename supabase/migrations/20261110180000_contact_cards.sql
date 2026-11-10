-- Digital business cards (2026-11-10) — dot-card style. Each card is a
-- PUBLIC page at employee.wallercountyems.com/card/<slug> (contact-card
-- edge fn through the Pages proxy, same pattern as /rsvp) with a
-- "Save contact" vCard built live from app_users + these overrides, so
-- printed QR codes never go stale. Cards are managed in-app at
-- /admin/contact-cards: pick a person, tweak titles/phones, upload a
-- photo, download the QR.
create table if not exists public.contact_cards (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  active boolean not null default true,
  title_override text,
  show_cell boolean not null default true,
  cell_override text,
  show_office boolean not null default true,
  blurb text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.contact_cards to authenticated;
grant all on public.contact_cards to service_role;

alter table public.contact_cards enable row level security;
-- cards are public by design; the signed-in portal may read them all
create policy contact_cards_select on public.contact_cards
  for select to authenticated using (true);
-- admins manage any card; a member may edit their own
create policy contact_cards_insert on public.contact_cards
  for insert to authenticated with check (is_admin());
create policy contact_cards_update on public.contact_cards
  for update to authenticated
  using (is_admin() or user_id = current_app_user_id());
create policy contact_cards_delete on public.contact_cards
  for delete to authenticated using (is_admin());

-- photos: public bucket (the card page is public); admins + the owner write
insert into storage.buckets (id, name, public)
values ('contact-cards', 'contact-cards', true)
on conflict (id) do nothing;

create policy "contact-cards read" on storage.objects
  for select to public using (bucket_id = 'contact-cards');
create policy "contact-cards write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contact-cards' and is_admin());
create policy "contact-cards update" on storage.objects
  for update to authenticated
  using (bucket_id = 'contact-cards' and is_admin());
create policy "contact-cards delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'contact-cards' and is_admin());

-- first card: Justin
insert into public.contact_cards (user_id, slug)
select id, 'justin' from public.app_users
where lower(email) = 'justin.stjohn@wallercountyems.com'
on conflict (user_id) do nothing;
