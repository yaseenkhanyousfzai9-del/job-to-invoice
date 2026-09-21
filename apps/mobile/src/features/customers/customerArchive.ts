import type { Customer } from "@job-to-invoice/domain";
import { DomainApiError, archiveCustomer as postArchiveCustomer } from "../../lib/api";
import { createClientUuid } from "../../lib/clientUuid";

export const ARCHIVE_CONFIRM_TITLE = "Archive this customer?";

export const ARCHIVE_CONFIRM_BODY =
  "This hides the customer from the Active list. Existing jobs and history are kept, and you can restore the customer later.";

export const ARCHIVE_CONFIRM_ACTION = "Archive customer";
export const ARCHIVE_CANCEL_ACTION = "Cancel";
export const ARCHIVE_ACTION_LABEL = "Archive customer";
export const RESTORE_ACTION_LABEL = "Restore customer";
export const ARCHIVING_LABEL = "Archiving…";
export const RESTORING_LABEL = "Restoring…";

export type ArchiveActionKind = "archive" | "restore";

export function isCustomerArchived(customer: Customer | null | undefined): boolean {
  return Boolean(customer?.archived_at);
}

export function archiveActionForCustomer(
  customer: Customer | null | undefined,
): ArchiveActionKind | null {
  if (!customer) return null;
  return isCustomerArchived(customer) ? "restore" : "archive";
}

export function archiveActionLabel(kind: ArchiveActionKind): string {
  return kind === "archive" ? ARCHIVE_ACTION_LABEL : RESTORE_ACTION_LABEL;
}

export function archivePendingLabel(kind: ArchiveActionKind): string {
  return kind === "archive" ? ARCHIVING_LABEL : RESTORING_LABEL;
}

export function createArchiveIdempotencySession(newKey: () => string = createClientUuid) {
  let key = newKey();
  let archivedTarget: boolean | null = null;

  return {
    keyForArchived(archived: boolean): string {
      if (archivedTarget !== archived) {
        archivedTarget = archived;
        key = newKey();
      }
      return key;
    },
    currentKey(): string {
      return key;
    },
  };
}

export type SubmitArchiveResult =
  | { kind: "success"; customer: Customer }
  | { kind: "unauthenticated"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "error"; message: string; retryable: boolean };

export function archiveActionErrorMessage(error: unknown): {
  message: string;
  retryable: boolean;
  unauthenticated: boolean;
  notFound: boolean;
} {
  if (error instanceof DomainApiError) {
    if (error.api.code === "UNAUTHENTICATED" || error.api.status === 401) {
      return {
        message: "Sign in to continue.",
        retryable: false,
        unauthenticated: true,
        notFound: false,
      };
    }
    if (error.api.status === 404 || error.api.code === "NOT_FOUND") {
      return {
        message: "Customer not found.",
        retryable: false,
        unauthenticated: false,
        notFound: true,
      };
    }
    if (error.api.code === "NETWORK" || error.api.status === 0) {
      return {
        message: "Couldn’t update customer. Check your connection and try again.",
        retryable: true,
        unauthenticated: false,
        notFound: false,
      };
    }
    if (error.api.code === "IDEMPOTENCY_MISMATCH") {
      return {
        message: "This action could not be completed. Try again.",
        retryable: false,
        unauthenticated: false,
        notFound: false,
      };
    }
    return {
      message:
        error.api.retryable || error.api.status >= 500
          ? "Couldn’t update customer. Check your connection and try again."
          : error.api.message || "Couldn’t update customer.",
      retryable: error.api.retryable || error.api.status >= 500,
      unauthenticated: false,
      notFound: false,
    };
  }
  return {
    message: "Couldn’t update customer. Check your connection and try again.",
    retryable: true,
    unauthenticated: false,
    notFound: false,
  };
}

export async function submitArchiveCustomer(options: {
  accessToken: string | null | undefined;
  customerId: string;
  archived: boolean;
  idempotencyKey: string;
  archive?: typeof postArchiveCustomer;
}): Promise<SubmitArchiveResult> {
  if (!options.accessToken) {
    return { kind: "unauthenticated", message: "Sign in to continue." };
  }

  const post = options.archive ?? postArchiveCustomer;
  try {
    const customer = await post(
      options.accessToken,
      options.customerId,
      options.archived,
      options.idempotencyKey,
    );
    return { kind: "success", customer };
  } catch (error) {
    const mapped = archiveActionErrorMessage(error);
    if (mapped.unauthenticated) {
      return { kind: "unauthenticated", message: mapped.message };
    }
    if (mapped.notFound) {
      return { kind: "not_found", message: mapped.message };
    }
    if (mapped.retryable) {
      return { kind: "network", message: mapped.message, retryable: true };
    }
    return { kind: "error", message: mapped.message, retryable: false };
  }
}
