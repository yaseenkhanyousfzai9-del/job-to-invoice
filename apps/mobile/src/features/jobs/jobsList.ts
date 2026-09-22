import type { JobListBucket, JobLifecycle, JobSummary } from "@job-to-invoice/domain";
import {
  DomainApiError,
  JOBS_LIST_DEFAULT_LIMIT,
  buildListJobsPath,
  listJobs,
  type JobListPage,
  type ListJobsParams,
} from "../../lib/api";

export const JOBS_LIST_SEARCH_DEBOUNCE_MS = 400;

export type JobsListPhase = "loading" | "ready" | "error" | "loading_more";

export type JobsListSnapshot = {
  phase: JobsListPhase;
  items: JobSummary[];
  nextCursor: string | null;
  bucket: JobListBucket;
  searchInput: string;
  appliedSearch: string | null;
  errorMessage: string | null;
  errorRetryable: boolean;
  loadMoreBlocked: boolean;
};

export type JobRowPresentation = {
  id: string;
  title: string;
  customerName: string;
  lifecycle: JobLifecycle;
  lifecycleLabel: string;
  accessibilityLabel: string;
};

const LIFECYCLE_LABELS: Record<JobLifecycle, string> = {
  draft: "Draft",
  active: "Active",
  invoiced: "Invoiced",
  finished: "Finished",
  canceled: "Canceled",
  archived: "Archived",
};

export function jobLifecycleLabel(lifecycle: string): string {
  if (lifecycle in LIFECYCLE_LABELS) {
    return LIFECYCLE_LABELS[lifecycle as JobLifecycle];
  }
  return lifecycle;
}

export function normalizeListSearch(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function initialJobsListSnapshot(): JobsListSnapshot {
  return {
    phase: "loading",
    items: [],
    nextCursor: null,
    bucket: "active",
    searchInput: "",
    appliedSearch: null,
    errorMessage: null,
    errorRetryable: false,
    loadMoreBlocked: false,
  };
}

export function buildInitialJobsListParams(
  snapshot: Pick<JobsListSnapshot, "bucket" | "appliedSearch">,
): ListJobsParams {
  return {
    bucket: snapshot.bucket,
    search: snapshot.appliedSearch,
    limit: JOBS_LIST_DEFAULT_LIMIT,
    cursor: null,
  };
}

/** S05 UI must never emit legacy `state` on general Jobs list requests. */
export function jobsListPathUsesLegacyState(path: string): boolean {
  return /[?&]state=/.test(path);
}

export function emptyJobsCopy(options: {
  bucket: JobListBucket;
  appliedSearch: string | null;
}): string {
  if (options.appliedSearch !== null) {
    return "No jobs found.";
  }
  if (options.bucket === "finished") {
    return "No finished jobs.";
  }
  if (options.bucket === "archived") {
    return "No archived jobs.";
  }
  return "No active jobs.";
}

export function showJobsEmptyState(snapshot: JobsListSnapshot): boolean {
  return snapshot.phase === "ready" && snapshot.items.length === 0;
}

export function showJobsInitialLoading(snapshot: JobsListSnapshot): boolean {
  return snapshot.phase === "loading" && snapshot.items.length === 0;
}

export function showJobsNewJobInEmptyState(snapshot: JobsListSnapshot): boolean {
  return (
    showJobsEmptyState(snapshot) &&
    snapshot.appliedSearch === null &&
    snapshot.bucket === "active"
  );
}

export function presentJobCard(job: JobSummary): JobRowPresentation {
  const lifecycleLabel = jobLifecycleLabel(job.lifecycle);
  return {
    id: job.id,
    title: job.title,
    customerName: job.customer.name,
    lifecycle: job.lifecycle,
    lifecycleLabel,
    accessibilityLabel: `${job.title}, ${job.customer.name}, ${lifecycleLabel}`,
  };
}

/** Cards are read-only summaries until S08 Job Detail exists. */
export function jobCardNavigatesToDetail(): boolean {
  return false;
}

export function listErrorRequiresSignOut(error: DomainApiError): boolean {
  return error.api.code === "UNAUTHENTICATED" || error.api.status === 401;
}

export function listErrorMessage(error: unknown): { message: string; retryable: boolean } {
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

export type JobsListController = {
  getSnapshot: () => JobsListSnapshot;
  subscribe: (listener: () => void) => () => void;
  bootstrap: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  retry: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  setBucket: (
    accessToken: string | null | undefined,
    bucket: JobListBucket,
  ) => Promise<"ok" | "unauthenticated">;
  setSearchInput: (accessToken: string | null | undefined, value: string) => void;
  flushSearchNow: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  loadMore: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated" | "blocked">;
  refreshPreservingFilters: (
    accessToken: string | null | undefined,
  ) => Promise<"ok" | "unauthenticated">;
  restoreUiState: (ui: {
    searchInput: string;
    appliedSearch: string | null;
    bucket: JobListBucket;
  }) => void;
  dispose: () => void;
};

export function createJobsListController(options?: {
  listJobs?: typeof listJobs;
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}): JobsListController {
  const fetchPage = options?.listJobs ?? listJobs;
  const debounceMs = options?.debounceMs ?? JOBS_LIST_SEARCH_DEBOUNCE_MS;
  const schedule =
    options?.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(id) };
    });

  let snapshot = initialJobsListSnapshot();
  let generation = 0;
  let loadMoreInFlight = false;
  let debounceHandle: { cancel: () => void } | null = null;
  const pageCache = new Map<string, { items: JobSummary[]; nextCursor: string | null }>();
  const listeners = new Set<() => void>();

  function cacheKey(bucket: JobListBucket, appliedSearch: string | null): string {
    return `${bucket}|${appliedSearch ?? ""}`;
  }

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(next: JobsListSnapshot) {
    snapshot = next;
    emit();
  }

  async function replaceList(
    accessToken: string | null | undefined,
    next: Partial<Pick<JobsListSnapshot, "bucket" | "appliedSearch" | "searchInput">>,
    mode: "reset" | "refresh" = "reset",
  ): Promise<"ok" | "unauthenticated"> {
    if (debounceHandle) {
      debounceHandle.cancel();
      debounceHandle = null;
    }
    const gen = ++generation;
    loadMoreInFlight = false;
    const mergedMeta = {
      ...snapshot,
      ...next,
    };
    const cached =
      mode === "reset" ? pageCache.get(cacheKey(mergedMeta.bucket, mergedMeta.appliedSearch)) : undefined;
    const keepItems = mode === "refresh" ? snapshot.items : cached ? cached.items : [];
    const keepCursor =
      mode === "refresh" ? snapshot.nextCursor : cached ? cached.nextCursor : null;
    setSnapshot({
      ...mergedMeta,
      phase: "loading",
      items: keepItems,
      nextCursor: keepCursor,
      errorMessage: null,
      errorRetryable: false,
      loadMoreBlocked: false,
    });

    if (!accessToken) {
      setSnapshot({
        ...snapshot,
        phase: "error",
        errorMessage: "Sign in to continue.",
        errorRetryable: false,
      });
      return "unauthenticated";
    }

    try {
      const params = buildInitialJobsListParams({
        bucket: snapshot.bucket,
        appliedSearch: snapshot.appliedSearch,
      });
      const page = await fetchPage(accessToken, params);
      if (gen !== generation) {
        return "ok";
      }
      pageCache.set(cacheKey(snapshot.bucket, snapshot.appliedSearch), {
        items: page.items,
        nextCursor: page.next_cursor,
      });
      setSnapshot({
        ...snapshot,
        phase: "ready",
        items: page.items,
        nextCursor: page.next_cursor,
        errorMessage: null,
        errorRetryable: false,
        loadMoreBlocked: false,
      });
      return "ok";
    } catch (cause) {
      if (gen !== generation) {
        return "ok";
      }
      if (cause instanceof DomainApiError && listErrorRequiresSignOut(cause)) {
        setSnapshot({
          ...snapshot,
          phase: "error",
          errorMessage: cause.api.message || "Sign in to continue.",
          errorRetryable: false,
        });
        return "unauthenticated";
      }
      const mapped = listErrorMessage(cause);
      setSnapshot({
        ...snapshot,
        phase: "error",
        items: keepItems,
        nextCursor: keepCursor,
        errorMessage: mapped.message,
        errorRetryable: mapped.retryable,
      });
      return "ok";
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bootstrap(accessToken) {
      return replaceList(accessToken, {}, "reset");
    },
    retry(accessToken) {
      return replaceList(accessToken, {}, snapshot.items.length > 0 ? "refresh" : "reset");
    },
    setBucket(accessToken, bucket) {
      if (bucket === snapshot.bucket && snapshot.phase !== "error") {
        return Promise.resolve("ok");
      }
      // Immediate — never share search debounce. Prefer cached page for the new bucket.
      return replaceList(accessToken, { bucket }, "reset");
    },
    setSearchInput(accessToken, value) {
      setSnapshot({
        ...snapshot,
        searchInput: value,
      });
      if (debounceHandle) {
        debounceHandle.cancel();
      }
      debounceHandle = schedule(() => {
        debounceHandle = null;
        const applied = normalizeListSearch(snapshot.searchInput);
        if (applied === snapshot.appliedSearch && snapshot.phase !== "error") {
          return;
        }
        void replaceList(accessToken, { appliedSearch: applied }, "reset");
      }, debounceMs);
    },
    flushSearchNow(accessToken) {
      if (debounceHandle) {
        debounceHandle.cancel();
        debounceHandle = null;
      }
      const applied = normalizeListSearch(snapshot.searchInput);
      if (applied === snapshot.appliedSearch && snapshot.phase !== "error") {
        return Promise.resolve("ok");
      }
      return replaceList(accessToken, { appliedSearch: applied }, "reset");
    },
    async loadMore(accessToken) {
      if (
        loadMoreInFlight ||
        snapshot.phase === "loading" ||
        snapshot.phase === "loading_more" ||
        snapshot.nextCursor === null ||
        snapshot.loadMoreBlocked
      ) {
        return "blocked";
      }
      if (!accessToken) {
        return "unauthenticated";
      }
      const gen = generation;
      loadMoreInFlight = true;
      setSnapshot({
        ...snapshot,
        phase: "loading_more",
        errorMessage: null,
        errorRetryable: false,
        loadMoreBlocked: true,
      });
      try {
        const page = await fetchPage(accessToken, {
          bucket: snapshot.bucket,
          search: snapshot.appliedSearch,
          limit: JOBS_LIST_DEFAULT_LIMIT,
          cursor: snapshot.nextCursor,
        });
        if (gen !== generation) {
          return "ok";
        }
        const merged = appendJobPage(snapshot.items, page);
        setSnapshot({
          ...snapshot,
          phase: "ready",
          items: merged.items,
          nextCursor: merged.nextCursor,
          loadMoreBlocked: false,
        });
        return "ok";
      } catch (cause) {
        if (gen !== generation) {
          return "ok";
        }
        if (cause instanceof DomainApiError && listErrorRequiresSignOut(cause)) {
          setSnapshot({
            ...snapshot,
            phase: "error",
            errorMessage: cause.api.message || "Sign in to continue.",
            errorRetryable: false,
            loadMoreBlocked: false,
          });
          return "unauthenticated";
        }
        const mapped = listErrorMessage(cause);
        setSnapshot({
          ...snapshot,
          phase: "error",
          errorMessage: mapped.message,
          errorRetryable: mapped.retryable,
          loadMoreBlocked: false,
        });
        return "ok";
      } finally {
        loadMoreInFlight = false;
      }
    },
    refreshPreservingFilters(accessToken) {
      return replaceList(accessToken, {}, "refresh");
    },
    restoreUiState(ui) {
      setSnapshot({
        ...snapshot,
        searchInput: ui.searchInput,
        appliedSearch: ui.appliedSearch,
        bucket: ui.bucket,
      });
    },
    dispose() {
      if (debounceHandle) {
        debounceHandle.cancel();
        debounceHandle = null;
      }
      listeners.clear();
      pageCache.clear();
      generation += 1;
    },
  };
}

export { buildListJobsPath, JOBS_LIST_DEFAULT_LIMIT };
