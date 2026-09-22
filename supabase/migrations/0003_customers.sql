-- CUST-DB-01: tenant-isolated customers persistence.
-- Do not add jobs, quotes, invoices, or Customer HTTP routes here.
-- CUS01: normalized_email must NOT be unique (duplicate contacts allowed after API confirmation).

create table if not exists app.customers (
  id uuid not null,
  workspace_id uuid not null references app.workspaces (id),
  name text not null,
  email text,
  normalized_email text,
  phone text,
  billing_address_json jsonb,
  archived_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references app.app_users (id),
  primary key (id),
  unique (workspace_id, id),
  constraint customers_name_trimmed_len
    check (char_length(btrim(name)) between 1 and 120),
  constraint customers_email_len
    check (email is null or char_length(email) <= 254),
  constraint customers_email_pair
    check ((email is null) = (normalized_email is null)),
  constraint customers_phone_len
    check (phone is null or char_length(phone) <= 20),
  constraint customers_version_positive
    check (version >= 1)
);

create index if not exists customers_workspace_updated_id_idx
  on app.customers (workspace_id, updated_at desc, id desc);

create index if not exists customers_workspace_normalized_email_idx
  on app.customers (workspace_id, normalized_email);

create index if not exists customers_workspace_active_updated_id_idx
  on app.customers (workspace_id, updated_at desc, id desc)
  where archived_at is null;

create trigger customers_set_updated_at
  before update on app.customers
  for each row
  execute function app.set_updated_at();

alter table app.customers enable row level security;
alter table app.customers force row level security;

create policy customers_tenant on app.customers
  for all
  to app_api
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

grant select, insert, update, delete on app.customers to app_api;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table app.customers from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table app.customers from authenticated;
  end if;
end
$$;
