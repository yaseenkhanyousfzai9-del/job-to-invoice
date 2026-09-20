import type { Customer, CustomerListState } from "@job-to-invoice/domain";
import {
  DomainApiError,
  buildListCustomersPath,
  listCustomers,
  type CustomerListPage,
  type ListCustomersParams,
} from "../../lib/api";

export const CUSTOMERS_LIST_DEFAULT_LIMIT = 25;
export const CUSTOMERS_LIST_SEARCH_DEBOUNCE_MS = 400;

export type CustomersListPhase = "loading" | "ready" | "error" | "loading_more";

export type CustomersListSnapshot = {
  phase: CustomersListPhase;
  items: Customer[];
  nextCursor: string | null;
  stateFilter: CustomerListState;
  searchInput: string;
  appliedSearch: string | null;
  errorMessage: string | null;
  errorRetryable: boolean;
  loadMoreBlocked: boolean;
};

export type CustomerRowPresentation = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  archivedLabel: string | null;
  accessibilityLabel: string;
};

export function normalizeListSearch(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function initialCustomersListSnapshot(): CustomersListSnapshot {
  return {
    phase: "loading",
    items: [],
    nextCursor: null,
    stateFilter: "active",
    searchInput: "",
    appliedSearch: null,
    errorMessage: null,
    errorRetryable: false,
    loadMoreBlocked: false,
  };
}

export function buildInitialListParams(
  snapshot: Pick<CustomersListSnapshot, "stateFilter" | "appliedSearch">,
): ListCustomersParams {
  return {
    state: snapshot.stateFilter,
    search: snapshot.appliedSearch,
    limit: CUSTOMERS_LIST_DEFAULT_LIMIT,
    cursor: null,
  };
}

export function emptyCustomersCopy(options: {
  stateFilter: CustomerListState;
  appliedSearch: string | null;
}): string {
  if (options.appliedSearch !== null) {
    return "No customers found.";
  }
  if (options.stateFilter === "archived") {
    return "No archived customers.";
  }
  return "No customers yet.";
}

export function showCustomersEmptyState(snapshot: CustomersListSnapshot): boolean {
  return snapshot.phase === "ready" && snapshot.items.length === 0;
}

export function showCustomersInitialLoading(snapshot: CustomersListSnapshot): boolean {
  return snapshot.phase === "loading" && snapshot.items.length === 0;
}

export function presentCustomerRow(customer: Customer): CustomerRowPresentation {
  const archivedLabel = customer.archived_at ? "Archived" : null;
  const parts = [customer.name];
  if (customer.email) parts.push(customer.email);
  if (customer.phone) parts.push(customer.phone);
  if (archivedLabel) parts.push(archivedLabel);
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    archivedLabel,
    accessibilityLabel: parts.join(", "),
  };
}

export function listErrorRequiresSignOut(error: DomainApiError): boolean {
  return error.api.code === "UNAUTHENTICATED" || error.api.status === 401;
}

export function listErrorMessage(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof DomainApiError) {
    if (error.api.code === "NETWORK" || error.api.status === 0) {
      return {
        message: "Couldn’t load customers. Check your connection and try again.",
        retryable: true,
      };
    }
    return {
      message:
        error.api.retryable || error.api.status >= 500
          ? "Couldn’t load customers. Check your connection and try again."
          : error.api.message || "Couldn’t load customers.",
      retryable: error.api.retryable || error.api.status >= 500,
    };
  }
  return {
    message: "Couldn’t load customers. Check your connection and try again.",
    retryable: true,
  };
}

export function appendCustomerPage(
  existing: Customer[],
  page: CustomerListPage,
): { items: Customer[]; nextCursor: string | null } {
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

export type CustomersListController = {
  getSnapshot: () => CustomersListSnapshot;
  subscribe: (listener: () => void) => () => void;
  bootstrap: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  retry: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  setStateFilter: (
    accessToken: string | null | undefined,
    stateFilter: CustomerListState,
  ) => Promise<"ok" | "unauthenticated">;
  setSearchInput: (accessToken: string | null | undefined, value: string) => void;
  flushSearchNow: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  loadMore: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated" | "blocked">;
  refreshPreservingFilters: (
    accessToken: string | null | undefined,
  ) => Promise<"ok" | "unauthenticated">;
  dispose: () => void;
};

export function createCustomersListController(options?: {
  listCustomers?: typeof listCustomers;
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}): CustomersListController {
  const fetchPage = options?.listCustomers ?? listCustomers;
  const debounceMs = options?.debounceMs ?? CUSTOMERS_LIST_SEARCH_DEBOUNCE_MS;
  const schedule =
    options?.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(id) };
    });

  let snapshot = initialCustomersListSnapshot();
  let generation = 0;
  let loadMoreInFlight = false;
  let debounceHandle: { cancel: () => void } | null = null;
  const pageCache = new Map<
    string,
    { items: Customer[]; nextCursor: string | null }
  >();
  const listeners = new Set<() => void>();

  function cacheKey(stateFilter: CustomerListState, appliedSearch: string | null): string {
    return `${stateFilter}|${appliedSearch ?? ""}`;
  }

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(next: CustomersListSnapshot) {
    snapshot = next;
    emit();
  }

  async function replaceList(
    accessToken: string | null | undefined,
    next: Partial<Pick<CustomersListSnapshot, "stateFilter" | "appliedSearch" | "searchInput">>,
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
      mode === "reset"
        ? pageCache.get(cacheKey(mergedMeta.stateFilter, mergedMeta.appliedSearch))
        : undefined;
    const keepItems =
      mode === "refresh" ? snapshot.items : cached ? cached.items : [];
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
      const page = await fetchPage(
        accessToken,
        buildInitialListParams({
          stateFilter: snapshot.stateFilter,
          appliedSearch: snapshot.appliedSearch,
        }),
      );
      if (gen !== generation) {
        return "ok";
      }
      pageCache.set(cacheKey(snapshot.stateFilter, snapshot.appliedSearch), {
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
    setStateFilter(accessToken, stateFilter) {
      if (stateFilter === snapshot.stateFilter && snapshot.phase !== "error") {
        return Promise.resolve("ok");
      }
  // Immediate request — never share search debounce. Prefer cached page for the
  // new filter so rows are not blanked; never show another filter's rows as current.
  return replaceList(accessToken, { stateFilter }, "reset");
    },
    setSearchInput(accessToken, value) {
      setSnapshot({
        ...snapshot,
        searchInput: value,
      });
      if (debounceHandle) {
        debounceHandle.cancel();
      }
      // Search-only debounce. Filter changes call setStateFilter directly.
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
          state: snapshot.stateFilter,
          search: snapshot.appliedSearch,
          limit: CUSTOMERS_LIST_DEFAULT_LIMIT,
          cursor: snapshot.nextCursor,
        });
        if (gen !== generation) {
          return "ok";
        }
        const merged = appendCustomerPage(snapshot.items, page);
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

export { buildListCustomersPath };
