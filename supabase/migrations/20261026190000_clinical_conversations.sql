-- Clinical conversations — documentation that a (non-disciplinary)
-- clinical conversation took place with an employee: incident, call
-- type/details, what was discussed, when/where, who was present,
-- optional signatures, and the employee's own response.
--
-- Access: clinical staff = pipeline editors + supervisors + admins
-- (Justin, 2026-10-26). The employee sees their own immediately and
-- responds/signs through SECURITY DEFINER RPCs (RLS update rules can't
-- scope columns).

create or replace function public.is_clinical_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users u
    where u.auth_user_id = auth.uid()
      and u.active
      and (
        u.role in ('admin', 'supervisor')
        or exists (select 1 from pipeline_editors e where e.user_id = u.id)
      )
  );
$$;

create table public.clinical_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_by uuid not null references public.app_users(id),
  created_by_name text not null default '',
  occurred_at timestamptz not null,
  location text not null default '',
  incident_number text not null default '',
  call_type text not null default '',
  call_details text not null default '',
  discussion text not null default '',
  require_signatures boolean not null default false,
  response text,
  response_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clinical_conversations_user_idx
  on public.clinical_conversations (user_id, occurred_at desc);

create table public.clinical_conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.clinical_conversations(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,
  display_name text not null,
  is_employee boolean not null default false,
  signature_data text,
  signed_at timestamptz
);

create index clinical_conversation_participants_conv_idx
  on public.clinical_conversation_participants (conversation_id);

alter table public.clinical_conversations enable row level security;
alter table public.clinical_conversation_participants enable row level security;

create policy conv_select on public.clinical_conversations
  for select using (is_clinical_staff() or user_id = current_app_user_id());
create policy conv_insert on public.clinical_conversations
  for insert with check (is_clinical_staff() and created_by = current_app_user_id());
create policy conv_update on public.clinical_conversations
  for update using (is_clinical_staff()) with check (is_clinical_staff());
create policy conv_delete on public.clinical_conversations
  for delete using (is_admin() or created_by = current_app_user_id());

create policy convp_select on public.clinical_conversation_participants
  for select using (
    is_clinical_staff()
    or exists (
      select 1 from public.clinical_conversations c
      where c.id = conversation_id and c.user_id = current_app_user_id()
    )
  );
create policy convp_insert on public.clinical_conversation_participants
  for insert with check (is_clinical_staff());
create policy convp_update on public.clinical_conversation_participants
  for update using (is_clinical_staff()) with check (is_clinical_staff());
create policy convp_delete on public.clinical_conversation_participants
  for delete using (is_clinical_staff());

grant select, insert, update, delete on public.clinical_conversations to authenticated;
grant select, insert, update, delete on public.clinical_conversation_participants to authenticated;
-- sched-notify reads these with the service-role client; the project's
-- default privileges don't cover service_role on hand-created tables.
grant select, insert, update, delete on public.clinical_conversations to service_role;
grant select, insert, update, delete on public.clinical_conversation_participants to service_role;

-- Employee response: one feedback box, re-saveable (timestamps the latest).
create or replace function public.clinical_conversation_respond(
  p_conversation uuid,
  p_response text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := current_app_user_id();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  update clinical_conversations
     set response = left(coalesce(p_response, ''), 4000),
         response_at = now(),
         updated_at = now()
   where id = p_conversation and user_id = me;
  if not found then
    raise exception 'Not your conversation';
  end if;
end;
$$;

-- Employee signs their own participant row (remote signing from their
-- device; in-person signing on the documenter's device goes through the
-- staff UPDATE policy instead).
create or replace function public.clinical_conversation_sign_mine(
  p_conversation uuid,
  p_signature text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := current_app_user_id();
begin
  if me is null or p_signature is null or p_signature = '' then
    raise exception 'Signature required';
  end if;
  update clinical_conversation_participants p
     set signature_data = p_signature,
         signed_at = now()
    from clinical_conversations c
   where c.id = p.conversation_id
     and p.conversation_id = p_conversation
     and p.user_id = me
     and c.require_signatures
     and p.signature_data is null;
  if not found then
    raise exception 'Nothing to sign';
  end if;
end;
$$;

grant execute on function public.clinical_conversation_respond(uuid, text) to authenticated;
grant execute on function public.clinical_conversation_sign_mine(uuid, text) to authenticated;
