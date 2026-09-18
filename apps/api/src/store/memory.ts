import { conflict } from "@job-to-invoice/domain";
import type { Customer } from "@job-to-invoice/domain";
import type {
  AllowanceRecord,
  AppUserRecord,
  AuthStore,
  CustomerRow,
  IdempotencyRecord,
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
  idempotency: Map<string, IdempotencyRecord>;
};

export type MemoryAuthHarness = {
  store: AuthStore;
  setUserStatus(authUserId: string, status: AppUserRecord["status"]): void;
  setCustomerArchived(workspaceId: string, customerId: string, archivedAt: string): void;
  listCustomerRows(workspaceId: string): CustomerRow[];
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

export function createMemoryAuthStore(): MemoryAuthHarness {
  const state: MemoryState = {
    usersByAuthId: new Map(),
    usersById: new Map(),
    bundlesByOwner: new Map(),
    customersByWorkspace: new Map(),
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
      return cloneBundle(bundle);
    },
    async findCustomersByNormalizedEmail(workspaceId, normalizedEmail) {
      const rows = state.customersByWorkspace.get(workspaceId) ?? [];
      return rows
        .filter((row) => row.normalized_email === normalizedEmail)
        .map((row) => ({ id: row.id, name: row.name }));
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
  };
}
