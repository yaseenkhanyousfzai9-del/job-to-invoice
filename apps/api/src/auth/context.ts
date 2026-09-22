import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  ENTITLEMENT_PLACEHOLDER,
  forbidden,
  normalizeEmail,
  unauthenticated,
  validateEmail,
  type MeData,
} from "@job-to-invoice/domain";
import type { FastifyRequest } from "fastify";
import type { VerifiedAccessToken } from "./jwt.ts";
import type { AuthStore, OwnerTx, WorkspaceBundle } from "../store/types.ts";

export type OwnerContext = {
  token: VerifiedAccessToken;
  userId: string;
  displayEmail: string;
  status: MeData["user"]["status"];
  bundle: WorkspaceBundle | null;
};

/** Resolve owner + membership inside an already-open owner transaction (AUTHZ01). */
export async function resolveOwnerInTransaction(
  tx: OwnerTx,
  token: VerifiedAccessToken,
  options?: { touchSession?: boolean },
): Promise<OwnerContext> {
  const email = validateEmail(token.email);
  if (email.error) {
    throw unauthenticated();
  }
  const touchSession = options?.touchSession !== false;
  const now = new Date().toISOString();
  let user = await tx.findUserByAuthId(token.subject);
  if (!user) {
    user = await tx.insertUser({
      id: crypto.randomUUID(),
      authUserId: token.subject,
      displayEmail: email.display,
      normalizedEmail: email.normalized,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
      now,
    });
  } else if (touchSession) {
    user = await tx.touchAuthentication(
      user.id,
      email.display,
      normalizeEmail(email.display),
      now,
    );
  }

  if (user.status === "deleted") {
    throw unauthenticated();
  }

  const bundle = await tx.findWorkspaceByOwner(user.id);
  return {
    token,
    userId: user.id,
    displayEmail: user.display_email,
    status: user.status,
    bundle,
  };
}

export async function loadOwnerContext(
  store: AuthStore,
  token: VerifiedAccessToken,
  options?: { touchSession?: boolean },
): Promise<OwnerContext> {
  return store.withOwnerTransaction(token.subject, async (tx) =>
    resolveOwnerInTransaction(tx, token, options),
  );
}

export function requireOwner(request: FastifyRequest): OwnerContext {
  if (!request.owner) {
    throw unauthenticated();
  }
  return request.owner;
}

export function requireVerifiedAccessToken(request: FastifyRequest): VerifiedAccessToken {
  if (!request.verifiedAccessToken) {
    throw unauthenticated();
  }
  return request.verifiedAccessToken;
}

export function requireActiveOwner(owner: OwnerContext): void {
  if (owner.status === "suspended") {
    throw forbidden("ACCOUNT_SUSPENDED", "This account cannot make changes.");
  }
  if (owner.status === "deleting") {
    throw forbidden("ACCOUNT_DELETING", "This account is locked for deletion.");
  }
  if (owner.status !== "active") {
    throw unauthenticated();
  }
}

export function toMeData(owner: OwnerContext): MeData {
  const ready = owner.bundle !== null;
  return {
    user: {
      id: owner.userId,
      display_email: owner.displayEmail,
      status: owner.status,
    },
    bootstrap_state: ready ? "ready" : "needs_workspace",
    workspace: owner.bundle
      ? {
          id: owner.bundle.workspace.id,
          business_name: owner.bundle.workspace.business_name,
          trade: owner.bundle.workspace.trade,
          timezone: owner.bundle.workspace.timezone,
          currency: "USD",
          version: owner.bundle.workspace.version,
        }
      : null,
    membership: owner.bundle
      ? {
          role: owner.bundle.membership.role,
          status: owner.bundle.membership.status,
        }
      : null,
    allowances: owner.bundle
      ? {
          free_jobs_consumed: owner.bundle.allowances.free_jobs_consumed,
          trial_started_at: owner.bundle.allowances.trial_started_at,
          trial_ends_at: owner.bundle.allowances.trial_ends_at,
          trial_jobs_consumed: owner.bundle.allowances.trial_jobs_consumed,
          retained_bytes: owner.bundle.allowances.retained_bytes,
          version: owner.bundle.allowances.version,
        }
      : null,
    entitlement: ENTITLEMENT_PLACEHOLDER,
  };
}
