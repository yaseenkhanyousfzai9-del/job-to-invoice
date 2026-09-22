import type { Customer } from "@job-to-invoice/domain";
import { DomainApiError, listCustomers, type CustomerListPage } from "../../lib/api";

export const CUSTOMER_PICKER_SEARCH_DEBOUNCE_MS = 300;
export const CUSTOMER_PICKER_DEFAULT_LIMIT = 25;

export type CustomerPickerSnapshot = {
  status: "idle" | "loading" | "ready" | "error";
  items: Customer[];
  searchInput: string;
  appliedSearch: string | null;
  errorMessage: string | null;
  errorRetryable: boolean;
  nextCursor: string | null;
  loadingMore: boolean;
};

function initialSnapshot(): CustomerPickerSnapshot {
  return {
    status: "idle",
    items: [],
    searchInput: "",
    appliedSearch: null,
    errorMessage: null,
    errorRetryable: false,
    nextCursor: null,
    loadingMore: false,
  };
}

function mapListError(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof DomainApiError) {
    if (error.api.code === "UNAUTHENTICATED" || error.api.status === 401) {
      return { message: error.api.message || "Sign in to continue.", retryable: false };
    }
    if (error.api.code === "NETWORK" || error.api.status === 0) {
      return {
        message: error.api.message || "Network problem. Check your connection and try again.",
        retryable: true,
      };
    }
    return {
      message:
        error.api.retryable || error.api.status >= 500
          ? "Couldn’t load customers. Try again."
          : error.api.message || "Couldn’t load customers.",
      retryable: error.api.retryable || error.api.status >= 500,
    };
  }
  return {
    message: "Couldn’t load customers. Check your connection and try again.",
    retryable: true,
  };
}

/** Active-only rows for new-job picker (CUS02 / S06). */
export function filterActiveCustomers(items: Customer[]): Customer[] {
  return items.filter((row) => row.archived_at === null);
}

export type CustomerPickerController = {
  getSnapshot: () => CustomerPickerSnapshot;
  subscribe: (listener: () => void) => () => void;
  bootstrap: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  retry: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  setSearchInput: (accessToken: string | null | undefined, value: string) => void;
  loadMore: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated" | "blocked">;
  refresh: (accessToken: string | null | undefined) => Promise<"ok" | "unauthenticated">;
  dispose: () => void;
};

export function createCustomerPickerController(options?: {
  listCustomers?: typeof listCustomers;
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}): CustomerPickerController {
  const fetchPage = options?.listCustomers ?? listCustomers;
  const debounceMs = options?.debounceMs ?? CUSTOMER_PICKER_SEARCH_DEBOUNCE_MS;
  const schedule =
    options?.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(id) };
    });

  let snapshot = initialSnapshot();
  let generation = 0;
  let loadMoreInFlight = false;
  let debounceHandle: { cancel: () => void } | null = null;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(patch: Partial<CustomerPickerSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    emit();
  }

  async function loadFirstPage(
    accessToken: string | null | undefined,
    appliedSearch: string | null,
    opts?: { keepItemsWhileLoading?: boolean },
  ): Promise<"ok" | "unauthenticated"> {
    if (!accessToken) {
      setSnapshot({
        status: "error",
        errorMessage: "Sign in to continue.",
        errorRetryable: false,
      });
      return "unauthenticated";
    }
    const gen = ++generation;
    setSnapshot({
      status: "loading",
      errorMessage: null,
      errorRetryable: false,
      ...(opts?.keepItemsWhileLoading ? {} : { items: [], nextCursor: null }),
      appliedSearch,
    });
    try {
      const page: CustomerListPage = await fetchPage(accessToken, {
        state: "active",
        search: appliedSearch,
        limit: CUSTOMER_PICKER_DEFAULT_LIMIT,
      });
      if (gen !== generation) {
        return "ok";
      }
      setSnapshot({
        status: "ready",
        items: filterActiveCustomers(page.items),
        nextCursor: page.next_cursor,
        errorMessage: null,
        errorRetryable: false,
        appliedSearch,
      });
      return "ok";
    } catch (cause) {
      if (gen !== generation) {
        return "ok";
      }
      const mapped = mapListError(cause);
      if (cause instanceof DomainApiError && (cause.api.code === "UNAUTHENTICATED" || cause.api.status === 401)) {
        setSnapshot({
          status: "error",
          errorMessage: mapped.message,
          errorRetryable: false,
        });
        return "unauthenticated";
      }
      setSnapshot({
        status: "error",
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
    async bootstrap(accessToken) {
      return loadFirstPage(accessToken, null);
    },
    async retry(accessToken) {
      return loadFirstPage(accessToken, snapshot.appliedSearch, { keepItemsWhileLoading: true });
    },
    setSearchInput(accessToken, value) {
      setSnapshot({ searchInput: value });
      debounceHandle?.cancel();
      debounceHandle = schedule(() => {
        const trimmed = value.trim();
        const applied = trimmed.length > 0 ? trimmed : null;
        void loadFirstPage(accessToken, applied);
      }, debounceMs);
    },
    async loadMore(accessToken) {
      if (!accessToken || !snapshot.nextCursor || loadMoreInFlight || snapshot.status !== "ready") {
        return "blocked";
      }
      loadMoreInFlight = true;
      setSnapshot({ loadingMore: true });
      const gen = generation;
      try {
        const page = await fetchPage(accessToken, {
          state: "active",
          search: snapshot.appliedSearch,
          limit: CUSTOMER_PICKER_DEFAULT_LIMIT,
          cursor: snapshot.nextCursor,
        });
        if (gen !== generation) {
          return "ok";
        }
        const seen = new Set(snapshot.items.map((item) => item.id));
        const merged = [...snapshot.items];
        for (const item of filterActiveCustomers(page.items)) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
          }
        }
        setSnapshot({
          items: merged,
          nextCursor: page.next_cursor,
          loadingMore: false,
        });
        return "ok";
      } catch (cause) {
        if (gen !== generation) {
          return "ok";
        }
        const mapped = mapListError(cause);
        if (cause instanceof DomainApiError && (cause.api.code === "UNAUTHENTICATED" || cause.api.status === 401)) {
          setSnapshot({ loadingMore: false, errorMessage: mapped.message, errorRetryable: false });
          return "unauthenticated";
        }
        setSnapshot({
          loadingMore: false,
          errorMessage: mapped.message,
          errorRetryable: mapped.retryable,
        });
        return "ok";
      } finally {
        loadMoreInFlight = false;
      }
    },
    async refresh(accessToken) {
      return loadFirstPage(accessToken, snapshot.appliedSearch, { keepItemsWhileLoading: true });
    },
    dispose() {
      debounceHandle?.cancel();
      listeners.clear();
    },
  };
}
