import type { CreatedJob, Customer, JobLifecycle, JobSummary } from "@job-to-invoice/domain";
import {
  conflict,
  decodeCustomerListCursor,
  decodeJobListCursor,
  encodeCustomerListCursor,
  encodeJobListCursor,
  nextArchivedAt,
} from "@job-to-invoice/domain";
import type {
  AllowanceRecord,
  AppUserRecord,
  AuthStore,
  CustomerRow,
  IdempotencyRecord,
  JobRow,
  MembershipRecord,
  OwnerTx,
  WorkspaceBundle,
  WorkspaceRecord,
} from "./types.ts";

type MemoryState = {
  usersByAuthId: Map<string, AppUserRecord>;
  usersById: Map<string, AppUserRecord>;
  bundlesByOwner: Map<string, WorkspaceBundle>;
  customersByWorkspace: Map<string, CustomerRow[]>;
  jobsByWorkspace: Map<string, JobRow[]>;
  idempotency: Map<string, IdempotencyRecord>;
};

export type MemoryAuthHarness = {
  store: AuthStore;
  setUserStatus(authUserId: string, status: AppUserRecord["status"]): void;
  setCustomerArchived(workspaceId: string, customerId: string, archivedAt: string): void;
  listCustomerRows(workspaceId: string): CustomerRow[];
  createJob(input: {
    workspaceId: string;
    customerId: string;
    createdBy: string;
    title: string;
    lifecycle?: JobLifecycle;
    updatedAt?: string;
    id?: string;
  }): Promise<JobSummary>;
};

function cloneBundle(bundle: WorkspaceBundle): WorkspaceBundle {
  return {
    workspace: { ...bundle.workspace, address: { ...bundle.workspace.address } },
    membership: { ...bundle.membership },
    allowances: { ...bundle.allowances },
  };
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    billing_address: row.billing_address,
    archived_at: row.archived_at,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toJobSummary(row: JobRow): JobSummary {
  return {
    id: row.id,
    title: row.title,
    lifecycle: row.lifecycle,
    updated_at: row.updated_at,
    customer_id: row.customer_id,
  };
}

function jobMatchesState(row: JobRow, state: string): boolean {
  if (state === "all") return true;
  if (state === "active") return row.lifecycle !== "archived";
  if (state === "archived") return row.lifecycle === "archived";
  return row.lifecycle === state;
}

export function createMemoryAuthStore(): MemoryAuthHarness {
  const state: MemoryState = {
    usersByAuthId: new Map(),
    usersById: new Map(),
    bundlesByOwner: new Map(),
    customersByWorkspace: new Map(),
    jobsByWorkspace: new Map(),
    idempotency: new Map(),
  };

  const tx: OwnerTx = {
    async findUserByAuthId(authUserId) {
      const row = state.usersByAuthId.get(authUserId);
      return row ? { ...row } : null;
    },
    async insertUser(input) {
      const existing = state.usersByAuthId.get(input.authUserId);
      if (existing) {
        return { ...existing };
      }
      const row: AppUserRecord = {
        id: input.id,
        auth_user_id: input.authUserId,
        normalized_email: input.normalizedEmail,
        display_email: input.displayEmail,
        status: "active",
        last_authenticated_at: input.now,
        deletion_requested_at: null,
        terms_version: input.termsVersion,
        privacy_version: input.privacyVersion,
        created_at: input.now,
        updated_at: input.now,
      };
      state.usersByAuthId.set(input.authUserId, row);
      state.usersById.set(row.id, row);
      return { ...row };
    },
    async touchAuthentication(userId, displayEmail, normalizedEmail, now) {
      const row = state.usersById.get(userId);
      if (!row) {
        throw new Error("user missing");
      }
      row.display_email = displayEmail;
      row.normalized_email = normalizedEmail;
      row.last_authenticated_at = now;
      row.updated_at = now;
      return { ...row };
    },
    async findWorkspaceByOwner(userId) {
      const bundle = state.bundlesByOwner.get(userId);
      return bundle ? cloneBundle(bundle) : null;
    },
    async createWorkspace(input) {
      if (state.bundlesByOwner.has(input.userId)) {
        throw conflict("WORKSPACE_EXISTS", "A workspace already exists for this account.");
      }
      const now = input.now;
      const workspaceId = crypto.randomUUID();
      const workspace: WorkspaceRecord = {
        id: workspaceId,
        owner_user_id: input.userId,
        business_name: input.fields.business_name,
        legal_name: input.fields.legal_name,
        contact_name: input.fields.contact_name,
        contact_email: input.fields.contact_email,
        contact_phone: input.fields.contact_phone,
        address: input.fields.address,
        timezone: input.fields.timezone,
        currency: "USD",
        trade: input.fields.trade,
        logo_asset_id: null,
        default_tax_bp: input.fields.default_tax_bp,
        default_due_days: input.fields.default_due_days,
        default_terms: input.fields.default_terms,
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: input.userId,
      };
      const membership: MembershipRecord = {
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        user_id: input.userId,
        role: "owner",
        status: "active",
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: input.userId,
      };
      const allowances: AllowanceRecord = {
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        free_jobs_consumed: 0,
        trial_started_at: null,
        trial_ends_at: null,
        trial_jobs_consumed: 0,
        retained_bytes: 0,
        version: 1,
        created_at: now,
        updated_at: now,
        created_by: input.userId,
      };
      const bundle = { workspace, membership, allowances };
      state.bundlesByOwner.set(input.userId, bundle);
      state.customersByWorkspace.set(workspaceId, []);
      state.jobsByWorkspace.set(workspaceId, []);
      return cloneBundle(bundle);
    },
    async findCustomersByNormalizedEmail(workspaceId, normalizedEmail, options) {
      const rows = state.customersByWorkspace.get(workspaceId) ?? [];
      const excludeId = options?.excludeCustomerId;
      return rows
        .filter(
          (row) =>
            row.normalized_email === normalizedEmail &&
            (excludeId === undefined || row.id !== excludeId),
        )
        .map((row) => ({ id: row.id, name: row.name }));
    },
    async getCustomer(workspaceId, customerId) {
      const rows = state.customersByWorkspace.get(workspaceId) ?? [];
      const row = rows.find((item) => item.id === customerId);
      return row ? toCustomer(row) : null;
    },
    async createCustomer(input) {
      const rows = state.customersByWorkspace.get(input.workspaceId) ?? [];
      const row: CustomerRow = {
        id: crypto.randomUUID(),
        workspace_id: input.workspaceId,
        name: input.fields.name,
        email: input.fields.email,
        normalized_email: input.fields.normalized_email,
        phone: input.fields.phone,
        billing_address: input.fields.billing_address,
        archived_at: null,
        version: 1,
        created_at: input.now,
        updated_at: input.now,
        created_by: input.createdBy,
      };
      rows.push(row);
      state.customersByWorkspace.set(input.workspaceId, rows);
      return toCustomer(row);
    },
    async updateCustomer(input) {
      const rows = state.customersByWorkspace.get(input.workspaceId) ?? [];
      const row = rows.find((item) => item.id === input.customerId);
      if (!row) {
        return { status: "not_found" };
      }
      if (row.version !== input.expectedVersion) {
        return { status: "version_conflict", customer: toCustomer(row) };
      }
      if (input.fields.name !== undefined) {
        row.name = input.fields.name;
      }
      if (input.fields.email !== undefined) {
        row.email = input.fields.email;
        row.normalized_email = input.fields.normalized_email ?? null;
      }
      if (input.fields.phone !== undefined) {
        row.phone = input.fields.phone;
      }
      if (input.fields.billing_address !== undefined) {
        row.billing_address = input.fields.billing_address;
      }
      row.version = row.version + 1;
      row.updated_at = input.now;
      return { status: "updated", customer: toCustomer(row) };
    },
    async archiveCustomer(input) {
      const rows = state.customersByWorkspace.get(input.workspaceId) ?? [];
      const row = rows.find((item) => item.id === input.customerId);
      if (!row) {
        return { status: "not_found" };
      }
      const currentlyArchived = row.archived_at !== null;
      if (input.archived === currentlyArchived) {
        return { status: "unchanged", customer: toCustomer(row) };
      }
      row.archived_at = nextArchivedAt(row.archived_at, input.archived, input.now);
      row.version = row.version + 1;
      row.updated_at = input.now;
      return { status: "updated", customer: toCustomer(row) };
    },
    async deleteCustomer(input) {
      const rows = state.customersByWorkspace.get(input.workspaceId) ?? [];
      const index = rows.findIndex((item) => item.id === input.customerId);
      if (index < 0) {
        return { status: "not_found" };
      }
      const jobs = state.jobsByWorkspace.get(input.workspaceId) ?? [];
      if (jobs.some((job) => job.customer_id === input.customerId)) {
        return { status: "referenced" };
      }
      rows.splice(index, 1);
      state.customersByWorkspace.set(input.workspaceId, rows);
      return { status: "deleted" };
    },
    async listCustomers(input) {
      const query = input.query;
      let rows = [...(state.customersByWorkspace.get(input.workspaceId) ?? [])];
      if (query.state === "active") {
        rows = rows.filter((row) => row.archived_at === null);
      } else if (query.state === "archived") {
        rows = rows.filter((row) => row.archived_at !== null);
      }
      if (query.search) {
        const needle = query.search.toLowerCase();
        rows = rows.filter((row) => {
          const name = row.name.toLowerCase();
          const email = (row.email ?? "").toLowerCase();
          const normalized = (row.normalized_email ?? "").toLowerCase();
          return name.includes(needle) || email.includes(needle) || normalized.includes(needle);
        });
      }
      rows.sort((a, b) => {
        if (a.updated_at === b.updated_at) {
          return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        }
        return a.updated_at < b.updated_at ? 1 : -1;
      });
      if (query.cursor) {
        const cursor = decodeCustomerListCursor(query.cursor, {
          state: query.state,
          search: query.search,
        });
        rows = rows.filter((row) => {
          if (row.updated_at < cursor.updated_at) {
            return true;
          }
          if (row.updated_at > cursor.updated_at) {
            return false;
          }
          return row.id < cursor.id;
        });
      }
      const page = rows.slice(0, query.limit + 1);
      const hasMore = page.length > query.limit;
      const items = (hasMore ? page.slice(0, query.limit) : page).map(toCustomer);
      const last = items[items.length - 1];
      const next_cursor =
        hasMore && last
          ? encodeCustomerListCursor({
              updated_at: last.updated_at,
              id: last.id,
              state: query.state,
              search: query.search,
            })
          : null;
      return { items, next_cursor };
    },
    async createJob(input) {
      const customers = state.customersByWorkspace.get(input.workspaceId) ?? [];
      if (!customers.some((row) => row.id === input.fields.customer_id)) {
        throw new Error("customer missing for job");
      }
      const rows = state.jobsByWorkspace.get(input.workspaceId) ?? [];
      if (rows.some((row) => row.id === input.fields.id)) {
        throw conflict("CONFLICT", "A job with this id already exists.");
      }
      const row: JobRow = {
        id: input.fields.id,
        workspace_id: input.workspaceId,
        customer_id: input.fields.customer_id,
        title: input.fields.title,
        lifecycle: "draft",
        updated_at: input.now,
        created_at: input.now,
        created_by: input.createdBy,
      };
      rows.push(row);
      state.jobsByWorkspace.set(input.workspaceId, rows);
      return {
        ...toJobSummary(row),
        version: 1,
        scope_version: 0,
        no_site: input.fields.no_site,
        site_address: input.fields.site_address
          ? { ...input.fields.site_address }
          : null,
        mode: input.fields.mode,
      } satisfies CreatedJob;
    },
    async listJobs(input) {
      const query = input.query;
      let rows = [...(state.jobsByWorkspace.get(input.workspaceId) ?? [])].filter(
        (row) => row.customer_id === query.customer_id,
      );
      rows = rows.filter((row) => jobMatchesState(row, query.state));
      if (query.search) {
        const needle = query.search.toLowerCase();
        rows = rows.filter((row) => row.title.toLowerCase().includes(needle));
      }
      rows.sort((a, b) => {
        if (a.updated_at === b.updated_at) {
          return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        }
        return a.updated_at < b.updated_at ? 1 : -1;
      });
      if (query.cursor) {
        const cursor = decodeJobListCursor(query.cursor, {
          customer_id: query.customer_id,
          state: query.state,
          search: query.search,
        });
        rows = rows.filter((row) => {
          if (row.updated_at < cursor.updated_at) {
            return true;
          }
          if (row.updated_at > cursor.updated_at) {
            return false;
          }
          return row.id < cursor.id;
        });
      }
      const page = rows.slice(0, query.limit + 1);
      const hasMore = page.length > query.limit;
      const items = (hasMore ? page.slice(0, query.limit) : page).map(toJobSummary);
      const last = items[items.length - 1];
      const next_cursor =
        hasMore && last
          ? encodeJobListCursor({
              updated_at: last.updated_at,
              id: last.id,
              customer_id: query.customer_id,
              state: query.state,
              search: query.search,
            })
          : null;
      return { items, next_cursor };
    },
    async getIdempotency(actorScope, key) {
      const row = state.idempotency.get(`${actorScope}:${key}`);
      return row ? { ...row } : null;
    },
    async putIdempotency(record) {
      state.idempotency.set(`${record.actor_scope}:${record.key}`, { ...record });
    },
  };

  let chain: Promise<unknown> = Promise.resolve();

  const store: AuthStore = {
    async withOwnerTransaction(_authUserId, fn) {
      const run = chain.then(() => fn(tx), () => fn(tx));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async listCustomersAuthorized(authUserId, query) {
      return store.withOwnerTransaction(authUserId, async (ownerTx) => {
        const user = await ownerTx.findUserByAuthId(authUserId);
        if (!user) {
          return { status: "no_user" as const };
        }
        const bundle = await ownerTx.findWorkspaceByOwner(user.id);
        const page = bundle
          ? await ownerTx.listCustomers({ workspaceId: bundle.workspace.id, query })
          : { items: [], next_cursor: null };
        return {
          status: "ok" as const,
          userId: user.id,
          displayEmail: user.display_email,
          accountStatus: user.status,
          page,
        };
      });
    },
    async getCustomerAuthorized(authUserId, customerId) {
      return store.withOwnerTransaction(authUserId, async (ownerTx) => {
        const user = await ownerTx.findUserByAuthId(authUserId);
        if (!user) {
          return { status: "no_user" as const };
        }
        const bundle = await ownerTx.findWorkspaceByOwner(user.id);
        const customer = bundle
          ? await ownerTx.getCustomer(bundle.workspace.id, customerId)
          : null;
        return {
          status: "ok" as const,
          userId: user.id,
          displayEmail: user.display_email,
          accountStatus: user.status,
          customer,
        };
      });
    },
    async listJobsAuthorized(authUserId, query) {
      return store.withOwnerTransaction(authUserId, async (ownerTx) => {
        const user = await ownerTx.findUserByAuthId(authUserId);
        if (!user) {
          return { status: "no_user" as const };
        }
        const bundle = await ownerTx.findWorkspaceByOwner(user.id);
        if (!bundle) {
          return { status: "customer_not_found" as const };
        }
        const customer = await ownerTx.getCustomer(bundle.workspace.id, query.customer_id);
        if (!customer) {
          return { status: "customer_not_found" as const };
        }
        const page = await ownerTx.listJobs({
          workspaceId: bundle.workspace.id,
          query,
        });
        return {
          status: "ok" as const,
          userId: user.id,
          displayEmail: user.display_email,
          accountStatus: user.status,
          page,
        };
      });
    },
  };

  return {
    store,
    setUserStatus(authUserId, status) {
      const row = state.usersByAuthId.get(authUserId);
      if (row) {
        row.status = status;
      }
    },
    setCustomerArchived(workspaceId, customerId, archivedAt) {
      const rows = state.customersByWorkspace.get(workspaceId) ?? [];
      const row = rows.find((item) => item.id === customerId);
      if (!row) {
        throw new Error("customer missing");
      }
      row.archived_at = archivedAt;
    },
    listCustomerRows(workspaceId) {
      return (state.customersByWorkspace.get(workspaceId) ?? []).map((row) => ({
        ...row,
        billing_address: row.billing_address ? { ...row.billing_address } : null,
      }));
    },
    async createJob(input) {
      const now = input.updatedAt ?? new Date().toISOString();
      const customers = state.customersByWorkspace.get(input.workspaceId) ?? [];
      if (!customers.some((row) => row.id === input.customerId)) {
        throw new Error("customer missing");
      }
      const rows = state.jobsByWorkspace.get(input.workspaceId) ?? [];
      const row: JobRow = {
        id: input.id ?? crypto.randomUUID(),
        workspace_id: input.workspaceId,
        customer_id: input.customerId,
        title: input.title,
        lifecycle: input.lifecycle ?? "draft",
        updated_at: now,
        created_at: now,
        created_by: input.createdBy,
      };
      rows.push(row);
      state.jobsByWorkspace.set(input.workspaceId, rows);
      return toJobSummary(row);
    },
  };
}
