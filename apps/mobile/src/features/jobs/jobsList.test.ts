import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobSummary } from "@job-to-invoice/domain";
import { DomainApiError, type JobListPage } from "../../lib/api";
import {
  JOBS_LIST_DEFAULT_LIMIT,
  JOBS_LIST_SEARCH_DEBOUNCE_MS,
  appendJobPage,
  buildInitialJobsListParams,
  buildListJobsPath,
  createJobsListController,
  emptyJobsCopy,
  initialJobsListSnapshot,
  jobCardNavigatesToDetail,
  jobLifecycleLabel,
  jobsListPathUsesLegacyState,
  listErrorRequiresSignOut,
  normalizeListSearch,
  presentJobCard,
  showJobsEmptyState,
  showJobsInitialLoading,
  showJobsNewJobInEmptyState,
} from "./jobsList";

function job(overrides: Partial<JobSummary> & Pick<JobSummary, "id" | "title">): JobSummary {
  return {
    lifecycle: "draft",
    updated_at: "2026-09-22T00:00:00.000Z",
    customer_id: "11111111-1111-4111-8111-111111111111",
    customer: { id: "11111111-1111-4111-8111-111111111111", name: "Sample Customer" },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("initial request uses bucket=active and limit=25", async () => {
  const calls: string[] = [];
  const controller = createJobsListController({
    listJobs: async (_token, params) => {
      calls.push(buildListJobsPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  assert.deepEqual(calls, [`/v1/jobs?bucket=active&limit=${JOBS_LIST_DEFAULT_LIMIT}`]);
  assert.deepEqual(buildInitialJobsListParams(initialJobsListSnapshot()), {
    bucket: "active",
    search: null,
    limit: 25,
    cursor: null,
  });
  assert.equal(controller.getSnapshot().bucket, "active");
});

test("Active selected by default", () => {
  assert.equal(initialJobsListSnapshot().bucket, "active");
});

test("Active / Finished / Archived filter requests use bucket only", async () => {
  const calls: string[] = [];
  const controller = createJobsListController({
    listJobs: async (_token, params) => {
      calls.push(buildListJobsPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  await controller.setBucket("token", "finished");
  await controller.setBucket("token", "archived");
  await controller.setBucket("token", "active");
  assert.ok(calls.some((p) => p.includes("bucket=finished")));
  assert.ok(calls.some((p) => p.includes("bucket=archived")));
  assert.ok(calls.at(-1)?.includes("bucket=active"));
  for (const path of calls) {
    assert.equal(jobsListPathUsesLegacyState(path), false);
  }
});

test("no legacy state param used by S05 UI paths", () => {
  const path = buildListJobsPath({
    bucket: "active",
    search: "Kitchen",
    limit: 25,
    cursor: null,
  });
  assert.equal(jobsListPathUsesLegacyState(path), false);
  assert.equal(path.includes("customer_id"), false);
});

test("loading state hides empty copy until ready", async () => {
  const gate = deferred<JobListPage>();
  const controller = createJobsListController({
    listJobs: async () => gate.promise,
  });
  const pending = controller.bootstrap("token");
  const loading = controller.getSnapshot();
  assert.equal(loading.phase, "loading");
  assert.equal(showJobsInitialLoading(loading), true);
  assert.equal(showJobsEmptyState(loading), false);
  gate.resolve({ items: [], next_cursor: null });
  await pending;
  assert.equal(showJobsEmptyState(controller.getSnapshot()), true);
});

test("Job card renders title, customer name, lifecycle; no internal fields", async () => {
  const controller = createJobsListController({
    listJobs: async () => ({
      items: [
        job({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Kitchen Remodel",
          lifecycle: "invoiced",
          customer: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Jordan Smith" },
        }),
      ],
      next_cursor: null,
    }),
  });
  await controller.bootstrap("token");
  const row = presentJobCard(controller.getSnapshot().items[0]!);
  assert.equal(row.title, "Kitchen Remodel");
  assert.equal(row.customerName, "Jordan Smith");
  assert.equal(row.lifecycleLabel, "Invoiced");
  assert.match(row.accessibilityLabel, /Kitchen Remodel/);
  assert.match(row.accessibilityLabel, /Jordan Smith/);
  assert.match(row.accessibilityLabel, /Invoiced/);
  assert.equal("customer_id" in row, false);
  assert.equal("workspace_id" in row, false);
  assert.equal("created_by" in row, false);
  assert.equal(jobCardNavigatesToDetail(), false);
});

test("lifecycle labels map documented values only", () => {
  assert.equal(jobLifecycleLabel("draft"), "Draft");
  assert.equal(jobLifecycleLabel("active"), "Active");
  assert.equal(jobLifecycleLabel("invoiced"), "Invoiced");
  assert.equal(jobLifecycleLabel("finished"), "Finished");
  assert.equal(jobLifecycleLabel("canceled"), "Canceled");
  assert.equal(jobLifecycleLabel("archived"), "Archived");
});

test("empty states are bucket-aware; New job only on Active empty", () => {
  assert.equal(emptyJobsCopy({ bucket: "active", appliedSearch: null }), "No active jobs.");
  assert.equal(emptyJobsCopy({ bucket: "finished", appliedSearch: null }), "No finished jobs.");
  assert.equal(emptyJobsCopy({ bucket: "archived", appliedSearch: null }), "No archived jobs.");
  assert.equal(emptyJobsCopy({ bucket: "active", appliedSearch: "zzz" }), "No jobs found.");
  const activeEmpty = {
    ...initialJobsListSnapshot(),
    phase: "ready" as const,
    items: [],
    bucket: "active" as const,
  };
  const archivedEmpty = { ...activeEmpty, bucket: "archived" as const };
  assert.equal(showJobsNewJobInEmptyState(activeEmpty), true);
  assert.equal(showJobsNewJobInEmptyState(archivedEmpty), false);
});

test("search request after debounce; trim; debounce ~400ms", async () => {
  const calls: string[] = [];
  const pendingFns: Array<() => void> = [];
  const controller = createJobsListController({
    debounceMs: JOBS_LIST_SEARCH_DEBOUNCE_MS,
    schedule: (fn, ms) => {
      assert.equal(ms, 400);
      pendingFns.push(fn);
      return { cancel: () => undefined };
    },
    listJobs: async (_token, params) => {
      calls.push(buildListJobsPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  const before = calls.length;
  controller.setSearchInput("token", "  Kitchen  ");
  assert.equal(calls.length, before);
  assert.equal(pendingFns.length, 1);
  pendingFns[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(
    calls.some((path) => path.includes("search=Kitchen") && path.includes("bucket=active")),
  );
  assert.equal(normalizeListSearch("  "), null);
});

test("search by title and customer name result rendering", async () => {
  const controller = createJobsListController({
    listJobs: async (_token, params) => {
      if (params.search === "Remodel") {
        return {
          items: [job({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Kitchen Remodel" })],
          next_cursor: null,
        };
      }
      if (params.search === "Smith") {
        return {
          items: [
            job({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              title: "Deck",
              customer: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Pat Smith" },
            }),
          ],
          next_cursor: null,
        };
      }
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  controller.setSearchInput("token", "Remodel");
  await controller.flushSearchNow("token");
  assert.equal(presentJobCard(controller.getSnapshot().items[0]!).title, "Kitchen Remodel");
  controller.setSearchInput("token", "Smith");
  await controller.flushSearchNow("token");
  assert.equal(presentJobCard(controller.getSnapshot().items[0]!).customerName, "Pat Smith");
});

test("stale search response blocked", async () => {
  const slow = deferred<JobListPage>();
  const fast = deferred<JobListPage>();
  const controller = createJobsListController({
    listJobs: async (_token, params = {}) => {
      if (params.search === "alpha") return slow.promise;
      if (params.search === "beta") return fast.promise;
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  controller.setSearchInput("token", "alpha");
  const pendingAlpha = controller.flushSearchNow("token");
  controller.setSearchInput("token", "beta");
  const pendingBeta = controller.flushSearchNow("token");
  fast.resolve({
    items: [job({ id: "11111111-1111-4111-8111-111111111111", title: "Beta" })],
    next_cursor: null,
  });
  await pendingBeta;
  slow.resolve({
    items: [job({ id: "22222222-2222-4222-8222-222222222222", title: "Alpha" })],
    next_cursor: null,
  });
  await pendingAlpha;
  assert.equal(controller.getSnapshot().items[0]?.title, "Beta");
  assert.equal(controller.getSnapshot().appliedSearch, "beta");
});

test("filter change requests immediately, preserves search, resets pagination", async () => {
  const paths: string[] = [];
  let pendingSearch: (() => void) | null = null;
  const controller = createJobsListController({
    debounceMs: 10_000,
    schedule: (fn) => {
      pendingSearch = fn;
      return { cancel: () => undefined };
    },
    listJobs: async (_token, params) => {
      paths.push(buildListJobsPath(params));
      return {
        items: [job({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "One" })],
        next_cursor: "cursor-keep",
      };
    },
  });
  await controller.bootstrap("token");
  controller.setSearchInput("token", "Kitchen");
  await controller.flushSearchNow("token");
  assert.equal(controller.getSnapshot().appliedSearch, "Kitchen");
  controller.setSearchInput("token", "pending");
  assert.ok(pendingSearch);
  await controller.setBucket("token", "finished");
  assert.equal(controller.getSnapshot().bucket, "finished");
  assert.equal(controller.getSnapshot().searchInput, "pending");
  assert.equal(controller.getSnapshot().appliedSearch, "Kitchen");
  assert.equal(paths.at(-1)?.includes("cursor="), false);
  assert.ok(paths.at(-1)?.includes("bucket=finished"));
  assert.ok(paths.at(-1)?.includes("search=Kitchen"));
});

test("network error + Retry; transient does not require sign-out", async () => {
  let fail = true;
  let calls = 0;
  const controller = createJobsListController({
    listJobs: async () => {
      calls += 1;
      if (fail) {
        throw new DomainApiError({
          code: "NETWORK",
          message: "Network problem",
          field_errors: {},
          retryable: true,
          status: 0,
        });
      }
      return {
        items: [job({ id: "33333333-3333-4333-8333-333333333333", title: "Recovered" })],
        next_cursor: null,
      };
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().phase, "error");
  assert.equal(controller.getSnapshot().errorRetryable, true);
  assert.equal(controller.getSnapshot().bucket, "active");
  fail = false;
  await controller.retry("token");
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().items[0]?.title, "Recovered");
  assert.ok(calls >= 2);
  assert.equal(
    listErrorRequiresSignOut(
      new DomainApiError({
        code: "NETWORK",
        message: "Network problem",
        field_errors: {},
        retryable: true,
        status: 0,
      }),
    ),
    false,
  );
  assert.equal(
    listErrorRequiresSignOut(
      new DomainApiError({
        code: "UNAUTHENTICATED",
        message: "Sign in",
        field_errors: {},
        retryable: false,
        status: 401,
      }),
    ),
    true,
  );
});

test("Load more appends, blocks duplicate, preserves order", async () => {
  const slow = deferred<JobListPage>();
  let moreCalls = 0;
  const controller = createJobsListController({
    listJobs: async (_token, params = {}) => {
      if (params.cursor) {
        moreCalls += 1;
        return slow.promise;
      }
      return {
        items: [job({ id: "11111111-1111-4111-8111-111111111111", title: "First" })],
        next_cursor: "cursor-a",
      };
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().nextCursor, "cursor-a");
  const firstMore = controller.loadMore("token");
  const blocked = await controller.loadMore("token");
  assert.equal(blocked, "blocked");
  assert.equal(moreCalls, 1);
  slow.resolve({
    items: [job({ id: "22222222-2222-4222-8222-222222222222", title: "Second" })],
    next_cursor: null,
  });
  await firstMore;
  assert.deepEqual(
    controller.getSnapshot().items.map((item) => item.title),
    ["First", "Second"],
  );
});

test("appendJobPage dedupes by id", () => {
  const first = job({ id: "11111111-1111-4111-8111-111111111111", title: "A" });
  const merged = appendJobPage([first], {
    items: [first, job({ id: "22222222-2222-4222-8222-222222222222", title: "B" })],
    next_cursor: null,
  });
  assert.deepEqual(
    merged.items.map((item) => item.title),
    ["A", "B"],
  );
});

test("refresh Active shows draft; Finished/Archived do not inject draft", async () => {
  const draft = job({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    title: "New Draft",
    lifecycle: "draft",
  });
  const finished = job({
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    title: "Done",
    lifecycle: "finished",
  });
  const controller = createJobsListController({
    listJobs: async (_token, params) => {
      if (params.bucket === "active") {
        return { items: [draft], next_cursor: null };
      }
      if (params.bucket === "finished") {
        return { items: [finished], next_cursor: null };
      }
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  await controller.refreshPreservingFilters("token");
  assert.equal(controller.getSnapshot().items[0]?.lifecycle, "draft");
  await controller.setBucket("token", "finished");
  await controller.refreshPreservingFilters("token");
  assert.equal(
    controller.getSnapshot().items.some((item) => item.lifecycle === "draft"),
    false,
  );
  await controller.setBucket("token", "archived");
  await controller.refreshPreservingFilters("token");
  assert.equal(controller.getSnapshot().items.length, 0);
  assert.equal(
    controller.getSnapshot().items.some((item) => item.lifecycle === "draft"),
    false,
  );
});
