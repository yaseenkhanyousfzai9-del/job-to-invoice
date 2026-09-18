-- SUPABASE-DEV-SETUP-01: login role for DATABASE_URL_API.
-- app_api remains NOLOGIN (privilege group). app_api_login is the runtime connection role.
-- Do not store the runtime password in this file.
-- Hosted Supabase's migration role is not a full superuser and cannot ALTER ROLE
-- attributes after create (SQLSTATE 42501). Set LOGIN / NOSUPERUSER / NOBYPASSRLS
-- only in CREATE ROLE. Password is set later, out of band:
--   ALTER ROLE app_api_login WITH PASSWORD '<development-only secret>';
-- Then point DATABASE_URL_API at app_api_login, never at postgres / superuser / BYPASSRLS.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api_login') then
    create role app_api_login
      login
      inherit
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls;
  end if;
end
$$;

grant app_api to app_api_login;
grant usage on schema app to app_api_login;
grant connect on database postgres to app_api_login;

alter default privileges in schema app grant select, insert, update, delete on tables to app_api;
alter default privileges in schema app grant usage, select on sequences to app_api;
