import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Customer } from "@job-to-invoice/domain";
import {
  CREATE_JOB_HREF,
  CREATE_JOB_KEYBOARD_SHOULD_PERSIST_TAPS,
  createJobHref,
  createJobHrefWithSelectedCustomer,
  customersNewHrefForCreateJob,
  isInvalidCreateJobHref,
} from "./jobRoutes";
import {
  buildCreateJobRequestBody,
  createJobIdempotencySession,
  createJobSuccessDetailParams,
  emptyCreateJobFormDraft,
  modeLabel,
  submitCreateJob,
  type CreateJobFormDraft,
} from "./createJobForm";
import {
  createCustomerPickerController,
  filterActiveCustomers,
  CUSTOMER_PICKER_DEFAULT_LIMIT,
} from "./customerPicker";
import { DomainApiError } from "../../lib/api";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../../../app");
const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sampleCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Pat",
    email: null,
    phone: null,
    billing_address: null,
    archived_at: null,
    version: 1,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

function baseDraft(overrides: Partial<CreateJobFormDraft> = {}): CreateJobFormDraft {
  return {
    ...emptyCreateJobFormDraft(),
    customerId: CUSTOMER_ID,
    customerName: "Pat",
    title: "Fence",
    noSite: true,
    mode: "quote",
    ...overrides,
  };
}

function siteDraft(overrides: Partial<CreateJobFormDraft> = {}): CreateJobFormDraft {
  return baseDraft({
    noSite: false,
    address_line1: "500 Site Rd",
    address_line2: "",
    city: "Austin",
    state: "TX",
    zip: "78701",
    ...overrides,
  });
}

test("Create Job entry opens correct route", () => {
  const shell = readFileSync(join(appDir, "(app)/index.tsx"), "utf8");
  assert.match(shell, /Create job/);
  assert.match(shell, /CREATE_JOB_HREF/);
  assert.equal(CREATE_JOB_HREF, "/(app)/jobs/new");
  assert.equal(createJobHref().pathname, "/(app)/jobs/new");
  assert.equal(isInvalidCreateJobHref("/(app)/jobs/new/index"), true);
  const routeFile = join(appDir, "(app)/jobs/new.tsx");
  assert.ok(readFileSync(routeFile, "utf8").includes("Create job"));
});

test("initial picker requests active Customers only", async () => {
  const calls: unknown[] = [];
  const controller = createCustomerPickerController({
    listCustomers: async (_token, params) => {
      calls.push(params);
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  assert.deepEqual(calls[0], {
    state: "active",
    search: null,
    limit: CUSTOMER_PICKER_DEFAULT_LIMIT,
  });
  controller.dispose();
});

test("archived Customers not offered", () => {
  const filtered = filterActiveCustomers([
    sampleCustomer({ id: "1", name: "Active" }),
    sampleCustomer({
      id: "2",
      name: "Archived",
      archived_at: "2026-09-21T00:00:00.000Z",
    }),
  ]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.name, "Active");
});

test("picker loading and empty and search", async () => {
  let resolvePage!: (value: { items: Customer[]; next_cursor: null }) => void;
  const controller = createCustomerPickerController({
    listCustomers: async () =>
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
    debounceMs: 0,
    schedule: (fn) => {
      fn();
      return { cancel: () => undefined };
    },
  });
  const pending = controller.bootstrap("token");
  assert.equal(controller.getSnapshot().status, "loading");
  resolvePage({ items: [], next_cursor: null });
  await pending;
  assert.equal(controller.getSnapshot().status, "ready");
  assert.equal(controller.getSnapshot().items.length, 0);

  const searches: (string | null | undefined)[] = [];
  const searchController = createCustomerPickerController({
    listCustomers: async (_token, params) => {
      searches.push(params?.search);
      return {
        items: [sampleCustomer()],
        next_cursor: null,
      };
    },
    debounceMs: 0,
    schedule: (fn) => {
      fn();
      return { cancel: () => undefined };
    },
  });
  searchController.setSearchInput("token", "Pat");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(searches.includes("Pat"), true);
  assert.equal(searchController.getSnapshot().items[0]?.name, "Pat");
  searchController.dispose();
  controller.dispose();
});

test("picker search stale-response protection", async () => {
  let finishSlow!: (value: { items: Customer[]; next_cursor: null }) => void;
  const controller = createCustomerPickerController({
    listCustomers: async (_token, params) => {
      if (params?.search === "slow") {
        return new Promise((resolve) => {
          finishSlow = resolve;
        });
      }
      return {
        items: [sampleCustomer({ name: "Fast" })],
        next_cursor: null,
      };
    },
    debounceMs: 0,
    schedule: (fn) => {
      fn();
      return { cancel: () => undefined };
    },
  });
  controller.setSearchInput("token", "slow");
  await new Promise((r) => setTimeout(r, 0));
  controller.setSearchInput("token", "fast");
  await new Promise((r) => setTimeout(r, 0));
  finishSlow({ items: [], next_cursor: null });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(controller.getSnapshot().items[0]?.name, "Fast");
  controller.dispose();
});

test("picker network error + Retry", async () => {
  let fail = true;
  const controller = createCustomerPickerController({
    listCustomers: async () => {
      if (fail) {
        throw new DomainApiError({
          code: "NETWORK",
          message: "down",
          field_errors: {},
          retryable: true,
          status: 0,
        });
      }
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(controller.getSnapshot().errorRetryable, true);
  fail = false;
  await controller.retry("token");
  assert.equal(controller.getSnapshot().status, "ready");
  controller.dispose();
});

test("title and site validation; customer_id only in body", () => {
  const missingCustomer = buildCreateJobRequestBody(
    { ...baseDraft(), customerId: null },
    JOB_ID,
  );
  assert.equal(missingCustomer.ok, false);

  const emptyTitle = buildCreateJobRequestBody(baseDraft({ title: "   " }), JOB_ID);
  assert.equal(emptyTitle.ok, false);

  const longTitle = buildCreateJobRequestBody(baseDraft({ title: "x".repeat(121) }), JOB_ID);
  assert.equal(longTitle.ok, false);

  const unicode = buildCreateJobRequestBody(baseDraft({ title: "  現場工事  " }), JOB_ID);
  assert.equal(unicode.ok, true);
  if (unicode.ok) {
    assert.equal(unicode.body.title, "現場工事");
    assert.equal(unicode.body.customer_id, CUSTOMER_ID);
    assert.equal(unicode.body.no_site, true);
    assert.equal(unicode.body.site_address, null);
    assert.equal("workspace_id" in unicode.body, false);
    assert.equal("customerName" in unicode.body, false);
  }

  const needsSite = buildCreateJobRequestBody(baseDraft({ noSite: false }), JOB_ID);
  assert.equal(needsSite.ok, false);

  const withSite = buildCreateJobRequestBody(siteDraft(), JOB_ID);
  assert.equal(withSite.ok, true);
  if (withSite.ok) {
    assert.equal(withSite.body.site_address?.line1, "500 Site Rd");
    assert.equal(withSite.body.no_site, false);
  }

  const noSiteWithAddress = buildCreateJobRequestBody(siteDraft({ noSite: true }), JOB_ID);
  assert.equal(noSiteWithAddress.ok, true);
  if (noSiteWithAddress.ok) {
    assert.equal(noSiteWithAddress.body.site_address, null);
    assert.equal(noSiteWithAddress.body.no_site, true);
  }
});

test("mode labels and defaults match S06 Quote / Direct invoice", () => {
  assert.equal(modeLabel("quote"), "Quote");
  assert.equal(modeLabel("direct_invoice"), "Direct invoice");
  assert.equal(emptyCreateJobFormDraft().mode, "quote");
});

test("Job id is client-generated UUID in request body", () => {
  const built = buildCreateJobRequestBody(baseDraft(), JOB_ID);
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.body.id, JOB_ID);
  }
});

test("POST success and CUSTOMER_ARCHIVED and network / idempotency", async () => {
  const success = await submitCreateJob({
    accessToken: "token",
    draft: baseDraft(),
    jobId: JOB_ID,
    idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    postJob: async (_token, body, key) => {
      assert.equal(key, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
      assert.equal(body.customer_id, CUSTOMER_ID);
      assert.equal(body.mode, "quote");
      return {
        id: body.id,
        title: body.title,
        lifecycle: "draft",
        updated_at: "t",
        customer_id: body.customer_id,
        customer: { id: body.customer_id, name: "Picker Customer" },
        version: 1,
        scope_version: 0,
        no_site: body.no_site,
        site_address: body.site_address,
        mode: body.mode,
      };
    },
  });
  assert.equal(success.kind, "success");

  const archived = await submitCreateJob({
    accessToken: "token",
    draft: baseDraft(),
    jobId: JOB_ID,
    idempotencyKey: "d",
    postJob: async () => {
      throw new DomainApiError({
        code: "CUSTOMER_ARCHIVED",
        message: "archived",
        field_errors: { customer_id: ["This customer is archived."] },
        retryable: false,
        status: 422,
      });
    },
  });
  assert.equal(archived.kind, "customer_archived");

  const network = await submitCreateJob({
    accessToken: "token",
    draft: baseDraft(),
    jobId: JOB_ID,
    idempotencyKey: "e",
    postJob: async () => {
      throw new DomainApiError({
        code: "NETWORK",
        message: "down",
        field_errors: {},
        retryable: true,
        status: 0,
      });
    },
  });
  assert.equal(network.kind, "network");

  const mismatch = await submitCreateJob({
    accessToken: "token",
    draft: baseDraft(),
    jobId: JOB_ID,
    idempotencyKey: "f",
    postJob: async () => {
      throw new DomainApiError({
        code: "IDEMPOTENCY_MISMATCH",
        message: "mismatch",
        field_errors: {},
        retryable: false,
        status: 409,
      });
    },
  });
  assert.equal(mismatch.kind, "idempotency_mismatch");
});

test("idempotency session reuses key until material draft changes", () => {
  let n = 0;
  const session = createJobIdempotencySession(() => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  });
  const draft = baseDraft();
  const first = session.keyForMaterialDraft(draft);
  const second = session.keyForMaterialDraft(draft);
  assert.equal(first, second);
  const third = session.keyForMaterialDraft(baseDraft({ title: "Other" }));
  assert.notEqual(first, third);
});

test("success navigation targets Customer Detail with jobCreated", () => {
  const href = createJobSuccessDetailParams(CUSTOMER_ID);
  assert.equal(href.pathname, "/(app)/customers/[id]");
  assert.equal(href.params.id, CUSTOMER_ID);
  assert.equal(href.params.jobCreated, "1");
});

test("Add customer from picker returns to Create Job with selection", () => {
  const add = customersNewHrefForCreateJob();
  assert.equal(add.pathname, "/(app)/customers/new");
  assert.equal(add.params.returnTo, "create-job");
  const back = createJobHrefWithSelectedCustomer(CUSTOMER_ID, "Pat");
  assert.equal(back.pathname, CREATE_JOB_HREF);
  assert.equal(back.params?.selectedCustomerId, CUSTOMER_ID);
});

test("keyboard persist taps constant for picker", () => {
  assert.equal(CREATE_JOB_KEYBOARD_SHOULD_PERSIST_TAPS, "always");
  const source = readFileSync(join(appDir, "(app)/jobs/new.tsx"), "utf8");
  assert.match(source, /CREATE_JOB_KEYBOARD_SHOULD_PERSIST_TAPS/);
  assert.match(source, /No site address/);
  assert.match(source, /Quote/);
  assert.match(source, /Direct invoice/);
});

test("rapid double submit guard pattern uses submittingRef in screen", () => {
  const source = readFileSync(join(appDir, "(app)/jobs/new.tsx"), "utf8");
  assert.match(source, /submittingRef/);
  assert.match(source, /keyForMaterialDraft/);
});
