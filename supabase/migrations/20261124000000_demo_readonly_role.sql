-- ─────────────────────────────────────────────────────────────────────
-- Demo (read-only admin) role — a visitor account that SEES the whole
-- portal the way an admin does and can change NOTHING (Justin,
-- 2026-11-24: visiting chiefs get a tour login).
--
-- How it works:
--   · role='demo' + account_type='demo' on the app_users row.
--   · is_admin() / is_clinical_editor() / is_clinical_staff() treat
--     demo as admin, so every admin-only SELECT policy passes and the
--     admin UI renders with live data.
--   · Writes are stopped by a BEFORE-statement trigger on EVERY public
--     table (attach_demo_guards below): any INSERT/UPDATE/DELETE from a
--     demo session aborts with "Demo account is read-only" — BEFORE
--     row triggers, BEFORE the write lands, regardless of what RLS
--     would have allowed. Service-role / cron writes carry no
--     auth.uid() and skip the check entirely.
--   · account_type <> 'person' keeps demo out of the directory,
--     birthdays, and roster-sync's deactivation sweep (same mechanics
--     as kiosks), and TS edge functions that check role === 'admin'
--     refuse demo, so it can't fire imports or notification sends.
--
-- After adding tables in a future migration, call
--   select public.attach_demo_guards();
-- again (it is idempotent) so the new tables are guarded too.
-- ─────────────────────────────────────────────────────────────────────

-- 1) account_type gains 'demo' ---------------------------------------
alter table public.app_users drop constraint app_users_account_type_check;
alter table public.app_users add constraint app_users_account_type_check
  check (account_type in ('person', 'kiosk', 'demo'));

-- 2) Who is a demo? ---------------------------------------------------
create or replace function public.is_demo()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where auth_user_id = auth.uid()
      and role = 'demo'
      and active = true
  );
$$;
grant execute on function public.is_demo() to authenticated;

-- 3) Demo reads like an admin ----------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where auth_user_id = auth.uid()
      and role in ('admin', 'demo')
      and active = true
  );
$$;

create or replace function public.is_clinical_editor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users u
    where u.auth_user_id = auth.uid()
      and u.active
      and (
        u.role in ('admin', 'demo')
        or exists (select 1 from pipeline_editors e where e.user_id = u.id)
      )
  );
$$;

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
        u.role in ('admin', 'supervisor', 'demo')
        or exists (select 1 from pipeline_editors e where e.user_id = u.id)
      )
  );
$$;

-- 4) ...and writes nothing -------------------------------------------
create or replace function public.enforce_demo_readonly()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  /* Service-role, pg_cron and trigger-chain writes carry no JWT. */
  if auth.uid() is not null and public.is_demo() then
    raise exception 'Demo account is read-only' using errcode = '42501';
  end if;
  return null; -- statement-level: return value is ignored
end;
$$;

create or replace function public.attach_demo_guards()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  t record;
  n int := 0;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'drop trigger if exists zzz_demo_readonly on public.%I', t.tablename);
    execute format(
      'create trigger zzz_demo_readonly
         before insert or update or delete on public.%I
         for each statement execute function public.enforce_demo_readonly()',
      t.tablename);
    n := n + 1;
  end loop;
  return n;
end;
$$;

select public.attach_demo_guards();

-- Storage uploads too, best-effort (ownership of storage.objects can
-- differ by project; the portal matters more than the bucket, so a
-- refusal here must not sink the migration).
do $$
begin
  execute 'drop trigger if exists zzz_demo_readonly on storage.objects';
  execute 'create trigger zzz_demo_readonly
             before insert or update or delete on storage.objects
             for each statement execute function public.enforce_demo_readonly()';
exception when others then
  raise notice 'storage.objects demo guard not attached: %', sqlerrm;
end;
$$;
