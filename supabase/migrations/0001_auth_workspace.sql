-- CUST-AUTH-01: owner identity, workspace bootstrap, and idempotency.
-- Do not add customers, jobs, quotes, or invoices here.

create schema if not exists app;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api nologin noinherit;
  end if;
end
$$;

grant usage on schema app to app_api;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists app.app_users (
  id uuid primary key,
  auth_user_id text not null unique,
  normalized_email text not null unique,
  display_email text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleting', 'deleted')),
  last_authenticated_at timestamptz not null,
  deletion_requested_at timestamptz,
  terms_version text not null,
  privacy_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app.app_users enable row level security;
alter table app.app_users force row level security;

create policy app_users_self on app.app_users
  for all
  to app_api
  using (auth_user_id = current_setting('app.auth_user_id', true))
  with check (auth_user_id = current_setting('app.auth_user_id', true));

create table if not exists app.workspaces (
  id uuid primary key,
  owner_user_id uuid not null unique references app.app_users (id),
  business_name text not null,
  legal_name text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  address_json jsonb not null,
  timezone text not null,
  currency text not null default 'USD' check (currency = 'USD'),
  trade text not null check (trade in ('handyman', 'other')),
  logo_asset_id uuid,
  default_tax_bp integer not null default 0 check (default_tax_bp >= 0 and default_tax_bp <= 10000),
  default_due_days integer not null default 14 check (default_due_days >= 0 and default_due_days <= 365),
  default_terms text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references app.app_users (id)
);

alter table app.workspaces enable row level security;
alter table app.workspaces force row level security;

create policy workspaces_tenant on app.workspaces
  for all
  to app_api
  using (
    id::text = current_setting('app.workspace_id', true)
    or owner_user_id in (
      select id from app.app_users
      where auth_user_id = current_setting('app.auth_user_id', true)
    )
  )
  with check (
    owner_user_id in (
      select id from app.app_users
      where auth_user_id = current_setting('app.auth_user_id', true)
    )
  );

create table if not exists app.memberships (
  id uuid not null,
  workspace_id uuid not null references app.workspaces (id),
  user_id uuid not null references app.app_users (id),
  role text not null default 'owner' check (role = 'owner'),
  status text not null default 'active' check (status = 'active'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references app.app_users (id),
  primary key (id),
  unique (workspace_id, id),
  unique (workspace_id, user_id)
);

create unique index if not exists memberships_one_active_owner
  on app.memberships (workspace_id)
  where role = 'owner' and status = 'active';

alter table app.memberships enable row level security;
alter table app.memberships force row level security;

create policy memberships_tenant on app.memberships
  for all
  to app_api
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

create table if not exists app.job_allowances (
  id uuid not null,
  workspace_id uuid not null unique references app.workspaces (id),
  free_jobs_consumed integer not null default 0,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_jobs_consumed integer not null default 0,
  retained_bytes bigint not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references app.app_users (id),
  primary key (id),
  unique (workspace_id, id)
);

alter table app.job_allowances enable row level security;
alter table app.job_allowances force row level security;

create policy job_allowances_tenant on app.job_allowances
  for all
  to app_api
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

create table if not exists app.idempotency_records (
  actor_scope text not null,
  key uuid not null,
  route text not null,
  request_hash text not null,
  operation_id uuid not null unique,
  status text not null,
  status_code integer,
  response_json jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (actor_scope, key)
);

alter table app.idempotency_records enable row level security;
alter table app.idempotency_records force row level security;

create policy idempotency_self on app.idempotency_records
  for all
  to app_api
  using (actor_scope in (
    select id::text from app.app_users
    where auth_user_id = current_setting('app.auth_user_id', true)
  ))
  with check (actor_scope in (
    select id::text from app.app_users
    where auth_user_id = current_setting('app.auth_user_id', true)
  ));

revoke all on all tables in schema app from public;
grant select, insert, update, delete on all tables in schema app to app_api;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema app from anon;
    revoke all on all tables in schema app from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema app from authenticated;
    revoke all on all tables in schema app from authenticated;
  end if;
end
$$;
