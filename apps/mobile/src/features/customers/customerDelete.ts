import { DomainApiError, deleteCustomer as deleteCustomerRequest } from "../../lib/api";
import { createClientUuid } from "../../lib/clientUuid";

export const DELETE_ACTION_LABEL = "Delete customer";
export const DELETE_CONFIRM_TITLE = "Delete this customer?";
export const DELETE_CONFIRM_BODY =
  "This permanently deletes the customer and cannot be undone. Customers linked to jobs cannot be deleted; archive them instead.";
export const DELETE_CONFIRM_ACTION = "Delete customer";
export const DELETE_CANCEL_ACTION = "Cancel";
export const DELETING_LABEL = "Deleting…";

export const DELETE_REFERENCED_MESSAGE =
  "This customer can’t be deleted because it is linked to one or more jobs.";
export const DELETE_REFERENCED_GUIDANCE =
  "Archive the customer instead to hide it from the Active list while keeping its history.";
export const DELETE_REFERENCED_ARCHIVE_ACTION = "Archive customer";

export const DELETE_NOT_FOUND_MESSAGE = "Customer no longer exists.";

export function createDeleteIdempotencySession(newKey: () => string = createClientUuid) {
  let key: string | null = null;

  return {
    keyForAttempt(): string {
      if (key === null) {
        key = newKey();
      }
      return key;
    },
    currentKey(): string | null {
      return key;
    },
    reset(): void {
      key = null;
    },
  };
}

export type SubmitDeleteResult =
  | { kind: "success"; deleted: true }
  | { kind: "unauthenticated"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "referenced"; message: string; guidance: string }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "error"; message: string; retryable: boolean };

export function deleteActionErrorMessage(error: unknown): {
  message: string;
  retryable: boolean;
  unauthenticated: boolean;
  notFound: boolean;
  referenced: boolean;
} {
  if (error instanceof DomainApiError) {
    if (error.api.code === "UNAUTHENTICATED" || error.api.status === 401) {
      return {
        message: "Sign in to continue.",
        retryable: false,
        unauthenticated: true,
        notFound: false,
        referenced: false,
      };
    }
    if (error.api.code === "CUSTOMER_REFERENCED") {
      return {
        message: DELETE_REFERENCED_MESSAGE,
        retryable: false,
        unauthenticated: false,
        notFound: false,
        referenced: true,
      };
    }
    if (error.api.code === "IDEMPOTENCY_MISMATCH") {
      return {
        message: "This action could not be completed. Try again.",
        retryable: false,
        unauthenticated: false,
        notFound: false,
        referenced: false,
      };
    }
    if (error.api.status === 404 || error.api.code === "NOT_FOUND") {
      return {
        message: DELETE_NOT_FOUND_MESSAGE,
        retryable: false,
        unauthenticated: false,
        notFound: true,
        referenced: false,
      };
    }
    if (error.api.code === "NETWORK" || error.api.status === 0) {
      return {
        message: "Couldn’t delete customer. Check your connection and try again.",
        retryable: true,
        unauthenticated: false,
        notFound: false,
        referenced: false,
      };
    }
    return {
      message:
        error.api.retryable || error.api.status >= 500
          ? "Couldn’t delete customer. Check your connection and try again."
          : error.api.message || "Couldn’t delete customer.",
      retryable: error.api.retryable || error.api.status >= 500,
      unauthenticated: false,
      notFound: false,
      referenced: false,
    };
  }
  return {
    message: "Couldn’t delete customer. Check your connection and try again.",
    retryable: true,
    unauthenticated: false,
    notFound: false,
    referenced: false,
  };
}

export async function submitDeleteCustomer(options: {
  accessToken: string | null | undefined;
  customerId: string;
  idempotencyKey: string;
  deleteCustomer?: typeof deleteCustomerRequest;
}): Promise<SubmitDeleteResult> {
  if (!options.accessToken) {
    return { kind: "unauthenticated", message: "Sign in to continue." };
  }

  const del = options.deleteCustomer ?? deleteCustomerRequest;
  try {
    const result = await del(options.accessToken, options.customerId, options.idempotencyKey);
    if (result.deleted === true) {
      return { kind: "success", deleted: true };
    }
    return {
      kind: "error",
      message: "Couldn’t delete customer.",
      retryable: false,
    };
  } catch (error) {
    const mapped = deleteActionErrorMessage(error);
    if (mapped.unauthenticated) {
      return { kind: "unauthenticated", message: mapped.message };
    }
    if (mapped.referenced) {
      return {
        kind: "referenced",
        message: DELETE_REFERENCED_MESSAGE,
        guidance: DELETE_REFERENCED_GUIDANCE,
      };
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
