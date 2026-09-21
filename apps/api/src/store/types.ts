import type {
  AccountStatus,
  CreateCustomerInput,
  Customer,
  CustomerListQuery,
  DuplicateCustomerMatch,
  JobListQuery,
  JobSummary,
  UsAddress,
  WorkspaceCreateInput,
  WorkspaceTrade,
} from "@job-to-invoice/domain";

export type AppUserRecord = {
  id: string;
  auth_user_id: string;
  normalized_email: string;
  display_email: string;
  status: AccountStatus;
  last_authenticated_at: string;
  deletion_requested_at: string | null;
  terms_version: string;
  privacy_version: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRecord = {
  id: string;
  owner_user_id: string;
  business_name: string;
  legal_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  address: UsAddress;
  timezone: string;
  currency: "USD";
  trade: WorkspaceTrade;
  logo_asset_id: string | null;
  default_tax_bp: number;
  default_due_days: number;
  default_terms: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
};

export type MembershipRecord = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: "owner";
  status: "active";
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
};

export type AllowanceRecord = {
  id: string;
  workspace_id: string;
  free_jobs_consumed: number;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_jobs_consumed: number;
  retained_bytes: number;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
};

export type WorkspaceBundle = {
  workspace: WorkspaceRecord;
  membership: MembershipRecord;
  allowances: AllowanceRecord;
};

export type IdempotencyRecord = {
  actor_scope: string;
  key: string;
  route: string;
  request_hash: string;
  status_code: number;
  response_json: unknown;
};

export type CustomerRow = Customer & {
  workspace_id: string;
  normalized_email: string | null;
  created_by: string;
};

export type JobRow = JobSummary & {
  workspace_id: string;
  created_at: string;
  created_by: string;
};

export type OwnerTx = {
  findUserByAuthId(authUserId: string): Promise<AppUserRecord | null>;
  insertUser(input: {
    id: string;
    authUserId: string;
    displayEmail: string;
    normalizedEmail: string;
    termsVersion: string;
    privacyVersion: string;
    now: string;
  }): Promise<AppUserRecord>;
  touchAuthentication(userId: string, displayEmail: string, normalizedEmail: string, now: string): Promise<AppUserRecord>;
  findWorkspaceByOwner(userId: string): Promise<WorkspaceBundle | null>;
  findCustomersByNormalizedEmail(
    workspaceId: string,
    normalizedEmail: string,
  ): Promise<DuplicateCustomerMatch[]>;
  createWorkspace(input: {
    userId: string;
    fields: WorkspaceCreateInput;
    now: string;
  }): Promise<WorkspaceBundle>;
  getCustomer(workspaceId: string, customerId: string): Promise<Customer | null>;
  createCustomer(input: {
    workspaceId: string;
    createdBy: string;
    fields: CreateCustomerInput;
    now: string;
  }): Promise<Customer>;
  listCustomers(input: {
    workspaceId: string;
    query: CustomerListQuery;
  }): Promise<{ items: Customer[]; next_cursor: string | null }>;
  createJob(input: {
    id: string;
    workspaceId: string;
    customerId: string;
    createdBy: string;
    title: string;
    now: string;
  }): Promise<JobSummary>;
  listJobs(input: {
    workspaceId: string;
    query: JobListQuery;
  }): Promise<{ items: JobSummary[]; next_cursor: string | null }>;
  getIdempotency(actorScope: string, key: string): Promise<IdempotencyRecord | null>;
  putIdempotency(record: IdempotencyRecord): Promise<void>;
};

export type CustomerListAuthorizedResult =
  | { status: "no_user" }
  | {
      status: "ok";
      userId: string;
      displayEmail: string;
      accountStatus: AccountStatus;
      page: { items: Customer[]; next_cursor: string | null };
    };

export type CustomerGetAuthorizedResult =
  | { status: "no_user" }
  | {
      status: "ok";
      userId: string;
      displayEmail: string;
      accountStatus: AccountStatus;
      customer: Customer | null;
    };

export type JobsListAuthorizedResult =
  | { status: "no_user" }
  | { status: "customer_not_found" }
  | {
      status: "ok";
      userId: string;
      displayEmail: string;
      accountStatus: AccountStatus;
      page: { items: JobSummary[]; next_cursor: string | null };
    };

export type AuthStore = {
  withOwnerTransaction<T>(
    authUserId: string,
    fn: (tx: OwnerTx) => Promise<T>,
  ): Promise<T>;
  /**
   * Customer list in one DB transaction with minimal round-trips:
   * resolve user+workspace membership and page customers together (AUTHZ01).
   */
  listCustomersAuthorized(
    authUserId: string,
    query: CustomerListQuery,
  ): Promise<CustomerListAuthorizedResult>;
  getCustomerAuthorized(
    authUserId: string,
    customerId: string,
  ): Promise<CustomerGetAuthorizedResult>;
  listJobsAuthorized(
    authUserId: string,
    query: JobListQuery,
  ): Promise<JobsListAuthorizedResult>;
  close?(): Promise<void>;
};
