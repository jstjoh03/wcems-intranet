-- Clinical conversations are a RECORD, not a document (Justin,
-- 2026-10-27: "I should not be able to go into Heather's notes on
-- Crystal's file and edit them"): once submitted they are read-only for
-- everyone -- admins included -- with two exceptions that complete the
-- record (signatures, the employee's response). The author alone may
-- delete, and only while the employee hasn't viewed, responded, or
-- signed. viewed_at stamps the employee's first open.
-- (Applied live 2026-10-27.)

alter table public.clinical_conversations add column if not exists viewed_at timestamptz;

drop policy if exists conv_update on public.clinical_conversations;
drop policy if exists convp_update on public.clinical_conversation_participants;
drop policy if exists convp_delete on public.clinical_conversation_participants;

drop policy if exists conv_delete on public.clinical_conversations;
create policy conv_delete on public.clinical_conversations
  for delete using (
    created_by = current_app_user_id()
    and viewed_at is null
    and response is null
    and not exists (
      select 1 from public.clinical_conversation_participants p
      where p.conversation_id = id and p.is_employee and p.signature_data is not null
    )
  );

drop policy if exists convp_insert on public.clinical_conversation_participants;
create policy convp_insert on public.clinical_conversation_participants
  for insert with check (
    exists (
      select 1 from public.clinical_conversations c
      where c.id = conversation_id
        and c.created_by = current_app_user_id()
        and c.viewed_at is null
    )
  );

create or replace function public.clinical_conversation_mark_viewed(p_conversation uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := current_app_user_id();
begin
  if me is null then return; end if;
  update clinical_conversations
     set viewed_at = coalesce(viewed_at, now())
   where id = p_conversation and user_id = me;
end;
$$;

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
         viewed_at = coalesce(viewed_at, now()),
         updated_at = now()
   where id = p_conversation and user_id = me;
  if not found then
    raise exception 'Not your conversation';
  end if;
end;
$$;

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
  update clinical_conversations
     set viewed_at = coalesce(viewed_at, now())
   where id = p_conversation and user_id = me;
end;
$$;

create or replace function public.clinical_conversation_sign_row(
  p_participant uuid,
  p_signature text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_clinical_staff() then
    raise exception 'Clinical staff only';
  end if;
  if p_signature is null or p_signature = '' then
    raise exception 'Signature required';
  end if;
  update clinical_conversation_participants p
     set signature_data = p_signature,
         signed_at = now()
    from clinical_conversations c
   where c.id = p.conversation_id
     and p.id = p_participant
     and c.require_signatures
     and p.signature_data is null;
  if not found then
    raise exception 'Nothing to sign';
  end if;
end;
$$;

grant execute on function public.clinical_conversation_mark_viewed(uuid) to authenticated;
grant execute on function public.clinical_conversation_sign_row(uuid, text) to authenticated;
