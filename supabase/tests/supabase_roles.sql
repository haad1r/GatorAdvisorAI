-- Supabase's built-in API roles, so the migrations can be tested on plain
-- Postgres (CI and local). Supabase projects already have these: never run
-- this against a Supabase project. Safe to run more than once.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
