import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobSummary } from "@job-to-invoice/domain";
import { buildListJobsPath } from "./jobsList";
import {
  clearJobsListSession,
  dropJobsListControllerForTest,
  getJobsListUiState,
  jobsListHasBootstrapped,
  markJobsListBootstrapped,
  nextJobsListFocusAction,
  obtainJobsListController,
  syncJobsListUiFromSnapshot,
} from "./jobsListSession";

function sampleJob(title: string): JobSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title,
    lifecycle: "draft",
    updated_at: "2026-09-22T00:00:00.000Z",
    customer_id: "22222222-2222-4222-8222-222222222222",
    customer: { id: "22222222-2222-4222-8222-222222222222", name: "Owner" },
  };
}

test("focus action is bootstrap first, then refresh after bootstrap", () => {
  clearJobsListSession();
  assert.equal(nextJobsListFocusAction(false), "bootstrap");
  assert.equal(nextJobsListFocusAction(true), "refresh");
});

test("returning to Jobs refreshes current bucket; search/bucket survive remount", async () => {
  clearJobsListSession();
  const calls: string[] = [];
  const controller = obtainJobsListController({
    debounceMs: 0,
    listJobs: async (_token, params = {}) => {
      calls.push(buildListJobsPath(params));
      return { items: [sampleJob("Kitchen")], next_cursor: null };
    },
  });

  await controller.bootstrap("token");
  markJobsListBootstrapped();
  controller.setSearchInput("token", "Kitchen");
  await controller.flushSearchNow("token");
  await controller.setBucket("token", "finished");
  syncJobsListUiFromSnapshot(controller.getSnapshot());

  dropJobsListControllerForTest();
  const remounted = obtainJobsListController({
    debounceMs: 0,
    listJobs: async (_token, params = {}) => {
      calls.push(buildListJobsPath(params));
      return { items: [], next_cursor: null };
    },
  });

  assert.equal(remounted.getSnapshot().searchInput, "Kitchen");
  assert.equal(remounted.getSnapshot().appliedSearch, "Kitchen");
  assert.equal(remounted.getSnapshot().bucket, "finished");
  assert.equal(getJobsListUiState().bucket, "finished");
  assert.equal(nextJobsListFocusAction(), "refresh");

  const before = calls.length;
  await remounted.refreshPreservingFilters("token");
  assert.equal(calls.length, before + 1);
  assert.match(calls[calls.length - 1] ?? "", /bucket=finished/);
  assert.match(calls[calls.length - 1] ?? "", /search=Kitchen/);

  clearJobsListSession();
});

test("Active / Finished / Archived filters survive remount", async () => {
  for (const bucket of ["active", "finished", "archived"] as const) {
    clearJobsListSession();
    const controller = obtainJobsListController({
      listJobs: async () => ({ items: [], next_cursor: null }),
    });
    await controller.bootstrap("token");
    markJobsListBootstrapped();
    await controller.setBucket("token", bucket);
    syncJobsListUiFromSnapshot(controller.getSnapshot());
    dropJobsListControllerForTest();
    const remounted = obtainJobsListController({
      listJobs: async () => ({ items: [], next_cursor: null }),
    });
    assert.equal(remounted.getSnapshot().bucket, bucket);
  }
  clearJobsListSession();
});

test("sign-out clear resets Jobs list session", async () => {
  clearJobsListSession();
  const controller = obtainJobsListController({
    listJobs: async () => ({ items: [], next_cursor: null }),
  });
  await controller.bootstrap("token");
  markJobsListBootstrapped();
  controller.setSearchInput("token", "keep me");
  await controller.flushSearchNow("token");
  syncJobsListUiFromSnapshot(controller.getSnapshot());

  clearJobsListSession();
  assert.equal(jobsListHasBootstrapped(), false);
  assert.deepEqual(getJobsListUiState(), {
    searchInput: "",
    appliedSearch: null,
    bucket: "active",
  });
  assert.equal(nextJobsListFocusAction(), "bootstrap");
});
