import type { JobListBucket } from "@job-to-invoice/domain";
import {
  createJobsListController,
  type JobsListController,
  type JobsListSnapshot,
} from "./jobsList";

/**
 * In-memory Jobs list UI session (not SecureStore).
 * Survives list remount when pushing New Job and coming back.
 * Cleared on sign-out only.
 */
export type JobsListUiState = {
  searchInput: string;
  appliedSearch: string | null;
  bucket: JobListBucket;
};

const DEFAULT_UI: JobsListUiState = {
  searchInput: "",
  appliedSearch: null,
  bucket: "active",
};

let uiState: JobsListUiState = { ...DEFAULT_UI };
let hasBootstrapped = false;
let sharedController: JobsListController | null = null;

export function getJobsListUiState(): JobsListUiState {
  return { ...uiState };
}

export function syncJobsListUiFromSnapshot(
  snapshot: Pick<JobsListSnapshot, "searchInput" | "appliedSearch" | "bucket">,
): void {
  uiState = {
    searchInput: snapshot.searchInput,
    appliedSearch: snapshot.appliedSearch,
    bucket: snapshot.bucket,
  };
}

export function jobsListHasBootstrapped(): boolean {
  return hasBootstrapped;
}

export function markJobsListBootstrapped(): void {
  hasBootstrapped = true;
}

/** Focus return: refresh with preserved filters after the first successful load. */
export function nextJobsListFocusAction(
  bootstrapped = hasBootstrapped,
): "bootstrap" | "refresh" {
  return bootstrapped ? "refresh" : "bootstrap";
}

export function obtainJobsListController(
  options?: Parameters<typeof createJobsListController>[0],
): JobsListController {
  if (!sharedController) {
    sharedController = createJobsListController(options);
    sharedController.restoreUiState(uiState);
  }
  return sharedController;
}

/** Test helper: drop the shared controller while keeping UI flags/state (simulates remount). */
export function dropJobsListControllerForTest(): void {
  if (sharedController) {
    syncJobsListUiFromSnapshot(sharedController.getSnapshot());
    sharedController.dispose();
    sharedController = null;
  }
}

export function clearJobsListSession(): void {
  if (sharedController) {
    sharedController.dispose();
    sharedController = null;
  }
  hasBootstrapped = false;
  uiState = { ...DEFAULT_UI };
}
