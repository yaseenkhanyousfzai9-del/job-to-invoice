import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Customer, JobSummary } from "@job-to-invoice/domain";
import { DomainApiError } from "../../lib/api";
import {
  appendJobPage,
  createCustomerDetailController,
  customerDetailApiPath,
  customerJobsApiPath,
  customerNotFoundCopy,
  emptyJobsCopy,
  formatBillingAddressLines,
  presentCustomerDetail,
  presentJobRow,
  showCustomerDetailLoading,
} from "./customerDetail";
import {
  CUSTOMERS_LIST_HREF,
  customerDetailHref,
  isInvalidCustomerDetailHref,
} from "./customerRoutes";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../../../app");

function sampleCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+15125550100",
    billing_address: {
      line1: "100 Main St",
      line2: "Suite 2",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    archived_at: null,
    version: 1,
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function sampleJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Fence repair",
    lifecycle: "draft",
    updated_at: "2026-09-20T12:00:00.000Z",
    customer_id: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("customer detail route file exists at customers/[id]/index.tsx", () => {
  assert.equal(existsSync(join(appDir, "(app)", "customers", "[id]", "index.tsx")), true);
});

test("customer edit route file exists at customers/[id]/edit.tsx", () => {
  assert.equal(existsSync(join(appDir, "(app)", "customers", "[id]", "edit.tsx")), true);
});

test("tapping customer uses canonical detail href with id only", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const href = customerDetailHref(id);
  assert.equal(href.pathname, "/(app)/customers/[id]");
  assert.deepEqual(href.params, { id });
  assert.equal(Object.keys(href.params).length, 1);
  assert.equal("email" in href.params, false);
  assert.equal("name" in href.params, false);
  assert.equal(isInvalidCustomerDetailHref(href), false);
  assert.equal(href.pathname.includes("/index"), false);
});

test("back target remains canonical Customers list", () => {
  assert.equal(CUSTOMERS_LIST_HREF, "/(app)/customers");
  assert.equal(CUSTOMERS_LIST_HREF.includes("/index"), false);
});

test("detail and jobs API paths use customer id and limit=25", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(customerDetailApiPath(id), `/v1/customers/${id}`);
  assert.equal(
    customerJobsApiPath(id),
    `/v1/jobs?customer_id=${id}&limit=25`,
  );
});

test("presentCustomerDetail renders contact fields and omits nulls", () => {
  const full = presentCustomerDetail(sampleCustomer());
  assert.equal(full.name, "Ada Lovelace");
  assert.equal(full.email, "ada@example.com");
  assert.equal(full.phone, "+15125550100");
  assert.equal(full.archivedLabel, null);
  assert.deepEqual(full.billingLines, ["100 Main St", "Suite 2", "Austin, TX 78701"]);

  const sparse = presentCustomerDetail(
    sampleCustomer({ email: null, phone: null, billing_address: null }),
  );
  assert.equal(sparse.email, null);
  assert.equal(sparse.phone, null);
  assert.equal(sparse.billingLines, null);
});

test("archived badge only when archived_at set", () => {
  assert.equal(presentCustomerDetail(sampleCustomer()).archivedLabel, null);
  assert.equal(
    presentCustomerDetail(sampleCustomer({ archived_at: "2026-09-20T00:00:00.000Z" }))
      .archivedLabel,
    "Archived",
  );
});

test("formatBillingAddressLines omits missing address", () => {
  assert.equal(formatBillingAddressLines(null), null);
  assert.deepEqual(
    formatBillingAddressLines({
      line1: "9 Oak Ave",
      line2: null,
      city: "Dallas",
      state: "TX",
      zip: "75201",
    }),
    ["9 Oak Ave", "Dallas, TX 75201"],
  );
});

test("job rows are non-pressable summaries with title and lifecycle", () => {
  const row = presentJobRow(sampleJob());
  assert.equal(row.title, "Fence repair");
  assert.equal(row.lifecycle, "draft");
  assert.equal(row.pressable, false);
  assert.equal(row.accessibilityLabel.includes("Fence repair"), true);
});

test("empty jobs copy is explicit and not an error", () => {
  assert.equal(emptyJobsCopy(), "No jobs for this customer yet.");
});

test("initial loading has no fake customer data", async () => {
  let resolveCustomer!: (value: Customer) => void;
  const customerGate = new Promise<Customer>((resolve) => {
    resolveCustomer = resolve;
  });
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async () => customerGate,
    listJobs: async () => ({ items: [], next_cursor: null }),
  });
  const boot = controller.bootstrap("token");
  await wait(5);
  const loading = controller.getSnapshot();
  assert.equal(showCustomerDetailLoading(loading), true);
  assert.equal(loading.customer, null);
  resolveCustomer(sampleCustomer());
  await boot;
  controller.dispose();
});

test("bootstrap loads customer and jobs in parallel with correct params", async () => {
  const calls: string[] = [];
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async (_token, id) => {
      calls.push(`customer:${id}`);
      return sampleCustomer({ id });
    },
    listJobs: async (_token, params) => {
      calls.push(`jobs:${params.customerId}:${params.limit}:${params.cursor ?? "null"}`);
      return {
        items: [sampleJob({ title: "A" }), sampleJob({ id: "33333333-3333-4333-8333-333333333333", title: "B" })],
        next_cursor: null,
      };
    },
  });
  const result = await controller.bootstrap("tok");
  assert.equal(result, "ok");
  const snap = controller.getSnapshot();
  assert.equal(snap.phase, "ready");
  assert.equal(snap.customer?.name, "Ada Lovelace");
  assert.equal(snap.jobs.length, 2);
  assert.equal(snap.jobs[0]?.title, "A");
  assert.equal(snap.jobs[1]?.title, "B");
  assert.deepEqual(calls, [
    "customer:11111111-1111-4111-8111-111111111111",
    "jobs:11111111-1111-4111-8111-111111111111:25:null",
  ]);
  controller.dispose();
});

test("zero jobs ready state uses empty copy helper", async () => {
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async () => sampleCustomer(),
    listJobs: async () => ({ items: [], next_cursor: null }),
  });
  await controller.bootstrap("tok");
  const snap = controller.getSnapshot();
  assert.equal(snap.jobs.length, 0);
  assert.equal(snap.jobsErrorMessage, null);
  assert.equal(emptyJobsCopy().length > 0, true);
  controller.dispose();
});

test("load more appends without duplicates and blocks double tap", async () => {
  let page = 0;
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async () => sampleCustomer(),
    listJobs: async (_token, params) => {
      if (!params.cursor) {
        page = 1;
        return {
          items: [sampleJob({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "First" })],
          next_cursor: "cursor-1",
        };
      }
      page = 2;
      return {
        items: [
          sampleJob({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "First" }),
          sampleJob({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Second" }),
        ],
        next_cursor: null,
      };
    },
  });
  await controller.bootstrap("tok");
  assert.equal(controller.getSnapshot().jobsNextCursor, "cursor-1");

  const first = controller.loadMoreJobs("tok");
  const second = controller.loadMoreJobs("tok");
  assert.equal(await second, "blocked");
  assert.equal(await first, "ok");
  const snap = controller.getSnapshot();
  assert.equal(snap.jobs.map((j) => j.title).join(","), "First,Second");
  assert.equal(snap.jobsNextCursor, null);
  assert.equal(page, 2);

  const merged = appendJobPage(snap.jobs, {
    items: [sampleJob({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Second" })],
    next_cursor: null,
  });
  assert.equal(merged.items.length, 2);
  controller.dispose();
});

test("transient customer error shows retryable message without signOut", async () => {
  let attempts = 0;
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new DomainApiError({
          code: "NETWORK",
          message: "Network problem.",
          field_errors: {},
          retryable: true,
          status: 0,
        });
      }
      return sampleCustomer();
    },
    listJobs: async () => ({ items: [], next_cursor: null }),
  });
  const first = await controller.bootstrap("tok");
  assert.equal(first, "ok");
  assert.equal(controller.getSnapshot().phase, "error");
  assert.equal(controller.getSnapshot().errorRetryable, true);
  assert.match(controller.getSnapshot().errorMessage ?? "", /connection/i);

  const second = await controller.retry("tok");
  assert.equal(second, "ok");
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().customer?.name, "Ada Lovelace");
  assert.equal(attempts, 2);
  controller.dispose();
});

test("customer 404 shows safe not-found state", async () => {
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async () => {
      throw new DomainApiError({
        code: "NOT_FOUND",
        message: "Not found.",
        field_errors: {},
        retryable: false,
        status: 404,
      });
    },
    listJobs: async () => ({ items: [], next_cursor: null }),
  });
  const result = await controller.bootstrap("tok");
  assert.equal(result, "ok");
  assert.equal(controller.getSnapshot().phase, "not_found");
  assert.equal(controller.getSnapshot().errorMessage, customerNotFoundCopy());
  assert.equal(controller.getSnapshot().errorRetryable, false);
  controller.dispose();
});

test("jobs failure keeps customer detail and allows jobs retry", async () => {
  let jobsAttempts = 0;
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async () => sampleCustomer(),
    listJobs: async () => {
      jobsAttempts += 1;
      if (jobsAttempts === 1) {
        throw new DomainApiError({
          code: "NETWORK",
          message: "Network problem.",
          field_errors: {},
          retryable: true,
          status: 0,
        });
      }
      return {
        items: [sampleJob()],
        next_cursor: null,
      };
    },
  });
  await controller.bootstrap("tok");
  const failed = controller.getSnapshot();
  assert.equal(failed.phase, "ready");
  assert.equal(failed.customer?.name, "Ada Lovelace");
  assert.equal(failed.jobs.length, 0);
  assert.equal(failed.jobsErrorRetryable, true);
  assert.match(failed.jobsErrorMessage ?? "", /jobs/i);

  await controller.retryJobs("tok");
  const recovered = controller.getSnapshot();
  assert.equal(recovered.jobs.length, 1);
  assert.equal(recovered.jobsErrorMessage, null);
  assert.equal(jobsAttempts, 2);
  controller.dispose();
});

test("401 on detail returns unauthenticated without inventing customer", async () => {
  const controller = createCustomerDetailController("11111111-1111-4111-8111-111111111111", {
    getCustomer: async () => {
      throw new DomainApiError({
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
        field_errors: {},
        retryable: false,
        status: 401,
      });
    },
    listJobs: async () => ({ items: [], next_cursor: null }),
  });
  const result = await controller.bootstrap("tok");
  assert.equal(result, "unauthenticated");
  assert.equal(controller.getSnapshot().customer, null);
  controller.dispose();
});
