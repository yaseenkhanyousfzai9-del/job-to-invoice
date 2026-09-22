-- Jobs table + composite customer FK (R-CUS-31 / R-CUS-PRE-05).
-- Full header schema from docs/DATABASE.md. No Jobs HTTP routes in this migration.
-- CUS02: ON DELETE RESTRICT on customer FK so referenced customers cannot be destroyed.

create table if not exists app.jobs (
  id uuid not null,
  workspace_id uuid not null references app.workspaces (id),
  customer_id uuid not null,
  title text not null,
  site_address_json jsonb,
  no_site boolean not null default false,
  lifecycle text not null default 'draft'
    check (lifecycle in ('draft', 'active', 'invoiced', 'finished', 'canceled', 'archived')),
  archived_from_state text,
  current_quote_id uuid,
  active_invoice_id uuid,
  scope_version integer not null default 0,
  first_published_at timestamptz,
  entitlement_origin text
    check (entitlement_origin is null or entitlement_origin in ('free', 'trial', 'paid')),
  completion_right boolean not null default false,
  internal_notes text not null default '',
  related_job_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references app.app_users (id),
  primary key (id),
  unique (workspace_id, id),
  constraint jobs_title_trimmed_len
    check (char_length(btrim(title)) between 1 and 120),
  constraint jobs_scope_version_nonneg
    check (scope_version >= 0),
  constraint jobs_version_positive
    check (version >= 1),
  constraint jobs_customer_same_workspace
    foreign key (workspace_id, customer_id)
    references app.customers (workspace_id, id)
    on delete restrict,
  constraint jobs_related_job_same_workspace
    foreign key (workspace_id, related_job_id)
    references app.jobs (workspace_id, id)
);

create index if not exists jobs_workspace_updated_id_idx
  on app.jobs (workspace_id, updated_at desc, id desc);

create index if not exists jobs_workspace_lifecycle_updated_idx
  on app.jobs (workspace_id, lifecycle, updated_at);

create index if not exists jobs_workspace_customer_updated_id_idx
  on app.jobs (workspace_id, customer_id, updated_at desc, id desc);

create trigger jobs_set_updated_at
  before update on app.jobs
  for each row
  execute function app.set_updated_at();

alter table app.jobs enable row level security;
alter table app.jobs force row level security;

create policy jobs_tenant on app.jobs
  for all
  to app_api
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

grant select, insert, update, delete on app.jobs to app_api;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table app.jobs from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table app.jobs from authenticated;
  end if;
end
$$;
