import type { BillingAddress, Customer, JobSummary } from "@job-to-invoice/domain";
import {
  DomainApiError,
  JOBS_LIST_DEFAULT_LIMIT,
  buildGetCustomerPath,
  buildListJobsPath,
  getCustomer,
  listJobs,
  type JobListPage,
} from "../../lib/api";
import {
  archiveActionForCustomer,
  createArchiveIdempotencySession,
  isCustomerArchived,
  submitArchiveCustomer,
  type ArchiveActionKind,
} from "./customerArchive";

export type CustomerDetailPhase =
  | "loading"
  | "ready"
  | "error"
  | "not_found"
  | "loading_more_jobs";

export type CustomerDetailSnapshot = {
  phase: CustomerDetailPhase;
  customerId: string;
  customer: Customer | null;
  jobs: JobSummary[];
  jobsNextCursor: string | null;
  errorMessage: string | null;
  errorRetryable: boolean;
  jobsErrorMessage: string | null;
  jobsErrorRetryable: boolean;
  loadMoreBlocked: boolean;
  archiveConfirmOpen: boolean;
  archivePending: boolean;
  archivePendingKind: ArchiveActionKind | null;
  archiveErrorMessage: string | null;
  archiveErrorRetryable: boolean;
  archiveRetryKind: ArchiveActionKind | null;
};

export type CustomerDetailPresentation = {
  name: string;
  email: string | null;
  phone: string | null;
  archivedLabel: string | null;
  billingLines: string[] | null;
};

export type JobRowPresentation = {
  id: string;
  title: string;
  lifecycle: string;
  updatedAt: string | null;
  accessibilityLabel: string;
  pressable: false;
};

export function initialCustomerDetailSnapshot(customerId: string): CustomerDetailSnapshot {
  return {
    phase: "loading",
    customerId,
    customer: null,
    jobs: [],
    jobsNextCursor: null,
    errorMessage: null,
    errorRetryable: false,
    jobsErrorMessage: null,
    jobsErrorRetryable: false,
    loadMoreBlocked: false,
    archiveConfirmOpen: false,
    archivePending: false,
    archivePendingKind: null,
    archiveErrorMessage: null,
    archiveErrorRetryable: false,
    archiveRetryKind: null,
  };
}

export function formatBillingAddressLines(address: BillingAddress | null | undefined): string[] | null {
  if (!address) return null;
  const lines: string[] = [];
  if (address.line1.trim().length > 0) lines.push(address.line1.trim());
  if (address.line2 && address.line2.trim().length > 0) lines.push(address.line2.trim());
  const city = address.city.trim();
  const state = address.state.trim();
  const zip = address.zip.trim();
  const localityParts: string[] = [];
  if (city.length > 0) localityParts.push(city);
  const stateZip = [state, zip].filter((part) => part.length > 0).join(" ");
  if (stateZip.length > 0) {
    if (localityParts.length > 0) {
      localityParts[0] = `${localityParts[0]}, ${stateZip}`;
    } else {
      localityParts.push(stateZip);
    }
  }
  if (localityParts.length > 0) {
    lines.push(localityParts[0]!);
  }
  return lines.length > 0 ? lines : null;
}

export function presentCustomerDetail(customer: Customer): CustomerDetailPresentation {
  return {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    archivedLabel: customer.archived_at ? "Archived" : null,
    billingLines: formatBillingAddressLines(customer.billing_address),
  };
}

export function presentJobRow(job: JobSummary): JobRowPresentation {
  return {
    id: job.id,
    title: job.title,
    lifecycle: job.lifecycle,
    updatedAt: job.updated_at,
    accessibilityLabel: `${job.title}, ${job.lifecycle}`,
    pressable: false,
  };
}

export function emptyJobsCopy(): string {
  return "No jobs for this customer yet.";
}

export function customerNotFoundCopy(): string {
  return "Customer not found.";
}

export function showCustomerDetailLoading(snapshot: CustomerDetailSnapshot): boolean {
  return snapshot.phase === "loading" && snapshot.customer === null;
}

export function detailErrorRequiresSignOut(error: DomainApiError): boolean {
  return error.api.code === "UNAUTHENTICATED" || error.api.status === 401;
}

export function isCustomerNotFoundError(error: unknown): boolean {
  return error instanceof DomainApiError && (error.api.status === 404 || error.api.code === "NOT_FOUND");
}

export function customerDetailErrorMessage(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof DomainApiError) {
    if (error.api.code === "NETWORK" || error.api.status === 0) {
      return {
        message: "Couldn’t load customer. Check your connection and try again.",
        retryable: true,
      };
    }
    return {
      message:
        error.api.retryable || error.api.status >= 500
          ? "Couldn’t load customer. Check your connection and try again."
          : error.api.message || "Couldn’t load customer.",
      retryable: error.api.retryable || error.api.status >= 500,
    };
  }
  return {
    message: "Couldn’t load customer. Check your connection and try again.",
    retryable: true,
  };
}

export function jobsSectionErrorMessage(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof DomainApiError) {
    if (error.api.code === "NETWORK" || error.api.status === 0) {
      return {
        message: "Couldn’t load jobs. Check your connection and try again.",
        retryable: true,
      };
    }
    return {
      message:
        error.api.retryable || error.api.status >= 500
          ? "Couldn’t load jobs. Check your connection and try again."
          : error.api.message || "Couldn’t load jobs.",
      retryable: error.api.retryable || error.api.status >= 500,
    };
  }
  return {
    message: "Couldn’t load jobs. Check your connection and try again.",
    retryable: true,
  };
}

export function appendJobPage(
  existing: JobSummary[],
  page: JobListPage,
): { items: JobSummary[]; nextCursor: string | null } {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const item of page.items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return { items: merged, nextCursor: page.next_cursor };
}

export function buildInitialJobsPath(customerId: string): string {
  return buildListJobsPath({
    customerId,
    limit: JOBS_LIST_DEFAULT_LIMIT,
    cursor: null,
  });
}

export type CustomerDetailController = {
  getSnapshot: () => CustomerDetailSnapshot;
  subscribe: (listener: () => void) => () => void;
  bootstrap: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  retry: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  retryJobs: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  loadMoreJobs: (
    accessToken: string | null | undefined,
  ) => Promise<"ok" | "unauthenticated" | "blocked">;
  openArchiveConfirm: () => void;
  cancelArchiveConfirm: () => void;
  confirmArchive: (
    accessToken: string | null | undefined,
  ) => Promise<"ok" | "unauthenticated" | "blocked">;
  restoreCustomer: (
    accessToken: string | null | undefined,
  ) => Promise<"ok" | "unauthenticated" | "blocked">;
  retryArchiveAction: (
    accessToken: string | null | undefined,
  ) => Promise<"ok" | "unauthenticated" | "blocked">;
  dispose: () => void;
};

export function createCustomerDetailController(
  customerId: string,
  options?: {
    getCustomer?: typeof getCustomer;
    listJobs?: typeof listJobs;
    archiveCustomer?: Parameters<typeof submitArchiveCustomer>[0]["archive"];
    onArchiveSuccess?: (customer: Customer, accessToken: string) => Promise<void> | void;
    newIdempotencyKey?: () => string;
  },
): CustomerDetailController {
  const fetchCustomer = options?.getCustomer ?? getCustomer;
  const fetchJobs = options?.listJobs ?? listJobs;
  const archivePost = options?.archiveCustomer;
  const onArchiveSuccess = options?.onArchiveSuccess;
  const idempotency = createArchiveIdempotencySession(options?.newIdempotencyKey);

  let snapshot = initialCustomerDetailSnapshot(customerId);
  const listeners = new Set<() => void>();
  let loadMoreInFlight = false;
  let archiveInFlight = false;
  let disposed = false;

  function emit() {
    for (const listener of listeners) listener();
  }

  function setSnapshot(patch: Partial<CustomerDetailSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    emit();
  }

  async function runArchiveAction(
    accessToken: string | null | undefined,
    kind: ArchiveActionKind,
  ): Promise<"ok" | "unauthenticated" | "blocked"> {
    if (archiveInFlight || snapshot.archivePending) {
      return "blocked";
    }
    if (!snapshot.customer) {
      return "blocked";
    }
    const expected = archiveActionForCustomer(snapshot.customer);
    if (expected !== kind) {
      return "blocked";
    }

    archiveInFlight = true;
    const archived = kind === "archive";
    const idempotencyKey = idempotency.keyForArchived(archived);
    setSnapshot({
      archiveConfirmOpen: false,
      archivePending: true,
      archivePendingKind: kind,
      archiveErrorMessage: null,
      archiveErrorRetryable: false,
      archiveRetryKind: null,
    });

    try {
      const result = await submitArchiveCustomer({
        accessToken,
        customerId,
        archived,
        idempotencyKey,
        ...(archivePost ? { archive: archivePost } : {}),
      });

      if (result.kind === "unauthenticated") {
        setSnapshot({
          archivePending: false,
          archivePendingKind: null,
          archiveErrorMessage: result.message,
          archiveErrorRetryable: false,
          archiveRetryKind: null,
        });
        return "unauthenticated";
      }

      if (result.kind === "success") {
        setSnapshot({
          phase: "ready",
          customer: result.customer,
          archivePending: false,
          archivePendingKind: null,
          archiveErrorMessage: null,
          archiveErrorRetryable: false,
          archiveRetryKind: null,
          archiveConfirmOpen: false,
        });
        if (accessToken && onArchiveSuccess) {
          try {
            await onArchiveSuccess(result.customer, accessToken);
          } catch {
            // List refresh is best-effort.
          }
        }
        return "ok";
      }

      const retryable = result.kind === "network" || (result.kind === "error" && result.retryable);
      setSnapshot({
        archivePending: false,
        archivePendingKind: null,
        archiveErrorMessage: result.message,
        archiveErrorRetryable: retryable,
        archiveRetryKind: retryable ? kind : null,
      });
      return "ok";
    } finally {
      archiveInFlight = false;
    }
  }

  async function loadAll(accessToken: string | null | undefined): Promise<"ok" | "unauthenticated"> {
    if (!accessToken) {
      setSnapshot({
        phase: "error",
        customer: null,
        jobs: [],
        jobsNextCursor: null,
        errorMessage: "Sign in to continue.",
        errorRetryable: false,
        jobsErrorMessage: null,
        jobsErrorRetryable: false,
        loadMoreBlocked: false,
      });
      return "unauthenticated";
    }

    setSnapshot({
      phase: "loading",
      errorMessage: null,
      errorRetryable: false,
      jobsErrorMessage: null,
      jobsErrorRetryable: false,
      loadMoreBlocked: false,
    });

    const customerPromise = fetchCustomer(accessToken, customerId);
    const jobsPromise = fetchJobs(accessToken, {
      customerId,
      limit: JOBS_LIST_DEFAULT_LIMIT,
      cursor: null,
    });

    let customer: Customer;
    try {
      customer = await customerPromise;
    } catch (error) {
      // Avoid unhandled rejection from the parallel jobs request.
      void jobsPromise.catch(() => undefined);
      if (error instanceof DomainApiError && detailErrorRequiresSignOut(error)) {
        setSnapshot({
          phase: "error",
          customer: null,
          jobs: [],
          jobsNextCursor: null,
          errorMessage: "Sign in to continue.",
          errorRetryable: false,
          jobsErrorMessage: null,
          jobsErrorRetryable: false,
        });
        return "unauthenticated";
      }
      if (isCustomerNotFoundError(error)) {
        setSnapshot({
          phase: "not_found",
          customer: null,
          jobs: [],
          jobsNextCursor: null,
          errorMessage: customerNotFoundCopy(),
          errorRetryable: false,
          jobsErrorMessage: null,
          jobsErrorRetryable: false,
        });
        return "ok";
      }
      const mapped = customerDetailErrorMessage(error);
      setSnapshot({
        phase: "error",
        customer: null,
        jobs: [],
        jobsNextCursor: null,
        errorMessage: mapped.message,
        errorRetryable: mapped.retryable,
        jobsErrorMessage: null,
        jobsErrorRetryable: false,
      });
      return "ok";
    }

    let jobs: JobSummary[] = [];
    let jobsNextCursor: string | null = null;
    let jobsErrorMessage: string | null = null;
    let jobsErrorRetryable = false;

    try {
      const page = await jobsPromise;
      jobs = page.items;
      jobsNextCursor = page.next_cursor;
    } catch (error) {
      if (error instanceof DomainApiError && detailErrorRequiresSignOut(error)) {
        setSnapshot({
          phase: "ready",
          customer,
          jobs: [],
          jobsNextCursor: null,
          errorMessage: null,
          errorRetryable: false,
          jobsErrorMessage: null,
          jobsErrorRetryable: false,
        });
        return "unauthenticated";
      }
      // Customer 404 on jobs filter should not wipe a successful customer read;
      // treat as jobs-section failure (API should 404 only when customer missing).
      if (isCustomerNotFoundError(error)) {
        const mapped = jobsSectionErrorMessage(error);
        jobsErrorMessage = mapped.message;
        jobsErrorRetryable = mapped.retryable;
      } else {
        const mapped = jobsSectionErrorMessage(error);
        jobsErrorMessage = mapped.message;
        jobsErrorRetryable = mapped.retryable;
      }
    }

    if (disposed) return "ok";

    setSnapshot({
      phase: "ready",
      customer,
      jobs,
      jobsNextCursor,
      errorMessage: null,
      errorRetryable: false,
      jobsErrorMessage,
      jobsErrorRetryable,
      loadMoreBlocked: false,
    });
    return "ok";
  }

  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bootstrap(accessToken) {
      return loadAll(accessToken);
    },
    retry(accessToken) {
      return loadAll(accessToken);
    },
    async retryJobs(accessToken) {
      if (!accessToken) return "unauthenticated";
      if (!snapshot.customer) {
        return loadAll(accessToken);
      }
      setSnapshot({
        jobsErrorMessage: null,
        jobsErrorRetryable: false,
      });
      try {
        const page = await fetchJobs(accessToken, {
          customerId,
          limit: JOBS_LIST_DEFAULT_LIMIT,
          cursor: null,
        });
        setSnapshot({
          jobs: page.items,
          jobsNextCursor: page.next_cursor,
          jobsErrorMessage: null,
          jobsErrorRetryable: false,
          phase: "ready",
        });
        return "ok";
      } catch (error) {
        if (error instanceof DomainApiError && detailErrorRequiresSignOut(error)) {
          return "unauthenticated";
        }
        const mapped = jobsSectionErrorMessage(error);
        setSnapshot({
          jobsErrorMessage: mapped.message,
          jobsErrorRetryable: mapped.retryable,
        });
        return "ok";
      }
    },
    async loadMoreJobs(accessToken) {
      if (loadMoreInFlight || snapshot.loadMoreBlocked || !snapshot.jobsNextCursor) {
        return "blocked";
      }
      if (!accessToken) return "unauthenticated";
      if (snapshot.phase === "loading_more_jobs") return "blocked";

      loadMoreInFlight = true;
      setSnapshot({ phase: "loading_more_jobs", loadMoreBlocked: true });
      try {
        const page = await fetchJobs(accessToken, {
          customerId,
          limit: JOBS_LIST_DEFAULT_LIMIT,
          cursor: snapshot.jobsNextCursor,
        });
        const merged = appendJobPage(snapshot.jobs, page);
        setSnapshot({
          phase: "ready",
          jobs: merged.items,
          jobsNextCursor: merged.nextCursor,
          loadMoreBlocked: false,
          jobsErrorMessage: null,
          jobsErrorRetryable: false,
        });
        return "ok";
      } catch (error) {
        if (error instanceof DomainApiError && detailErrorRequiresSignOut(error)) {
          setSnapshot({ phase: "ready", loadMoreBlocked: false });
          return "unauthenticated";
        }
        const mapped = jobsSectionErrorMessage(error);
        setSnapshot({
          phase: "ready",
          loadMoreBlocked: false,
          jobsErrorMessage: mapped.message,
          jobsErrorRetryable: mapped.retryable,
        });
        return "ok";
      } finally {
        loadMoreInFlight = false;
      }
    },
    openArchiveConfirm() {
      if (!snapshot.customer || isCustomerArchived(snapshot.customer) || snapshot.archivePending) {
        return;
      }
      setSnapshot({
        archiveConfirmOpen: true,
        archiveErrorMessage: null,
        archiveErrorRetryable: false,
        archiveRetryKind: null,
      });
    },
    cancelArchiveConfirm() {
      if (snapshot.archivePending) return;
      setSnapshot({ archiveConfirmOpen: false });
    },
    confirmArchive(accessToken) {
      return runArchiveAction(accessToken, "archive");
    },
    restoreCustomer(accessToken) {
      return runArchiveAction(accessToken, "restore");
    },
    retryArchiveAction(accessToken) {
      const kind = snapshot.archiveRetryKind;
      if (!kind) return Promise.resolve("blocked" as const);
      return runArchiveAction(accessToken, kind);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/** Exported for tests — confirms detail path uses id only. */
export function customerDetailApiPath(customerId: string): string {
  return buildGetCustomerPath(customerId);
}

export function customerJobsApiPath(customerId: string): string {
  return buildInitialJobsPath(customerId);
}
