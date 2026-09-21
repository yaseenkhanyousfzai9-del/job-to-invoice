import type { CustomerListState } from "@job-to-invoice/domain";
import {
  createCustomersListController,
  type CustomersListController,
  type CustomersListSnapshot,
} from "./customersList";

/**
 * In-memory Customers list UI session (not SecureStore).
 * Survives list screen remount when pushing Customer Detail / New and coming back.
 * Cleared on sign-out only.
 */
export type CustomersListUiState = {
  searchInput: string;
  appliedSearch: string | null;
  stateFilter: CustomerListState;
};

const DEFAULT_UI: CustomersListUiState = {
  searchInput: "",
  appliedSearch: null,
  stateFilter: "active",
};

let uiState: CustomersListUiState = { ...DEFAULT_UI };
let hasBootstrapped = false;
let sharedController: CustomersListController | null = null;

export function getCustomersListUiState(): CustomersListUiState {
  return { ...uiState };
}

export function syncCustomersListUiFromSnapshot(
  snapshot: Pick<CustomersListSnapshot, "searchInput" | "appliedSearch" | "stateFilter">,
): void {
  uiState = {
    searchInput: snapshot.searchInput,
    appliedSearch: snapshot.appliedSearch,
    stateFilter: snapshot.stateFilter,
  };
}

export function customersListHasBootstrapped(): boolean {
  return hasBootstrapped;
}

export function markCustomersListBootstrapped(): void {
  hasBootstrapped = true;
}

/** Focus return: refresh with preserved filters after the first successful load. */
export function nextCustomersListFocusAction(
  bootstrapped = hasBootstrapped,
): "bootstrap" | "refresh" {
  return bootstrapped ? "refresh" : "bootstrap";
}

export function obtainCustomersListController(
  options?: Parameters<typeof createCustomersListController>[0],
): CustomersListController {
  if (!sharedController) {
    sharedController = createCustomersListController(options);
    sharedController.restoreUiState(uiState);
  }
  return sharedController;
}

/** Test helper: drop the shared controller while keeping UI flags/state (simulates remount). */
export function dropCustomersListControllerForTest(): void {
  if (sharedController) {
    syncCustomersListUiFromSnapshot(sharedController.getSnapshot());
    sharedController.dispose();
    sharedController = null;
  }
}

export function clearCustomersListSession(): void {
  if (sharedController) {
    sharedController.dispose();
    sharedController = null;
  }
  hasBootstrapped = false;
  uiState = { ...DEFAULT_UI };
}
