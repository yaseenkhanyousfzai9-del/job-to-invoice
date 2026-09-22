export type AccountStatus = "active" | "suspended" | "deleting" | "deleted";

export type BootstrapState = "needs_workspace" | "ready";

export type OwnerUserSummary = {
  id: string;
  display_email: string;
  status: AccountStatus;
};

export type WorkspaceSummary = {
  id: string;
  business_name: string;
  trade: "handyman" | "other";
  timezone: string;
  currency: "USD";
  version: number;
};

export type MembershipSummary = {
  role: "owner";
  status: "active";
};

export type AllowanceSummary = {
  free_jobs_consumed: number;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_jobs_consumed: number;
  retained_bytes: number;
  version: number;
};

export type EntitlementPlaceholder = {
  status: "none";
  product_id: null;
  expires_at: null;
};

export type MeData = {
  user: OwnerUserSummary;
  bootstrap_state: BootstrapState;
  workspace: WorkspaceSummary | null;
  membership: MembershipSummary | null;
  allowances: AllowanceSummary | null;
  entitlement: EntitlementPlaceholder;
};

export const ENTITLEMENT_PLACEHOLDER: EntitlementPlaceholder = {
  status: "none",
  product_id: null,
  expires_at: null,
};

export type OwnerNavigation =
  | "welcome"
  | "sign_in"
  | "verify"
  | "setup"
  | "app"
  | "suspended"
  | "deleting";

export function resolveOwnerNavigation(input: {
  hasSession: boolean;
  me: MeData | null;
}): OwnerNavigation {
  if (!input.hasSession) {
    return "welcome";
  }
  if (!input.me) {
    return "sign_in";
  }
  if (input.me.user.status === "suspended") {
    return "suspended";
  }
  if (input.me.user.status === "deleting" || input.me.user.status === "deleted") {
    return "deleting";
  }
  if (input.me.bootstrap_state === "needs_workspace" || input.me.workspace === null) {
    return "setup";
  }
  return "app";
}
