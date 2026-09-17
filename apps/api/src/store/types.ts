import type { AccountStatus } from "@job-to-invoice/domain";
import type { UsAddress } from "@job-to-invoice/domain";
import type { WorkspaceCreateInput, WorkspaceTrade } from "@job-to-invoice/domain";

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
  createWorkspace(input: {
    userId: string;
    fields: WorkspaceCreateInput;
    now: string;
  }): Promise<WorkspaceBundle>;
  getIdempotency(actorScope: string, key: string): Promise<IdempotencyRecord | null>;
  putIdempotency(record: IdempotencyRecord): Promise<void>;
};

export type AuthStore = {
  withOwnerTransaction<T>(
    authUserId: string,
    fn: (tx: OwnerTx) => Promise<T>,
  ): Promise<T>;
};
