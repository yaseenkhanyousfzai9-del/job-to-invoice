/**
 * Customer module dependency-boundary tests (mobile).
 * Proves Customer UI logic does not require S05/S06 controllers, Quote/Invoice modules, or Job Detail.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Customer, JobSummary } from "@job-to-invoice/domain";
import { buildListCustomersPath, buildListJobsPath } from "../../lib/api";
import {
  createCustomerDetailController,
  customerJobsApiPath,
  presentJobRow,
} from "./customerDetail";
import {
  CREATE_JOB_RETURN_PATHNAME,
  createJobReturnHrefWithSelectedCustomer,
  CUSTOMERS_LIST_HREF,
  CUSTOMERS_NEW_HREF,
  customerDetailHref,
  customerEditHref,
} from "./customerRoutes";

const here = dirname(fileURLToPath(import.meta.url));
const featuresRoot = join(here, "..");
const customersDir = here;

function readFeature(relativeFromFeatures: string): string {
  return readFileSync(join(featuresRoot, relativeFromFeatures), "utf8");
}

function readCustomerModule(name: string): string {
  return readFileSync(join(customersDir, name), "utf8");
}

/** Frozen public Customer DTO keys (must match CUSTOMER_MODULE_CONTRACT / API helpers). */
const CUSTOMER_PUBLIC_DTO_KEYS = [
  "id",
  "name",
  "email",
  "phone",
  "billing_address",
  "archived_at",
  "version",
  "created_at",
  "updated_at",
] as const;

const sampleCustomer = (overrides?: Partial<Customer>): Customer => ({
  id: "cccccccc-cccc-4ccc-8ccc-000000000001",
  name: "Boundary Customer",
  email: "boundary@example.test",
  phone: null,
  billing_address: null,
  archived_at: null,
  version: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const sampleJob = (overrides?: Partial<JobSummary>): JobSummary => ({
  id: "jjjjjjjj-jjjj-4jjj-8jjj-000000000001",
  title: "Boundary Job",
  lifecycle: "draft",
  updated_at: "2026-01-02T00:00:00.000Z",
  customer_id: "cccccccc-cccc-4ccc-8ccc-000000000001",
  customer: { id: "cccccccc-cccc-4ccc-8ccc-000000000001", name: "Boundary Customer" },
  ...overrides,
});

test("Customer Detail jobs section uses customer-scoped jobs API path (not S05 bucket)", () => {
  const customerId = "cccccccc-cccc-4ccc-8ccc-0000000000aa";
  const path = customerJobsApiPath(customerId);
  assert.match(path, /\/v1\/jobs\?/);
  assert.match(path, /customer_id=cccccccc-cccc-4ccc-8ccc-0000000000aa/);
  assert.equal(path.includes("bucket="), false);
  assert.equal(buildListJobsPath({ customerId, limit: 25, cursor: null }), path);
});

test("Customer Detail renders Job summaries without S05 list controller", async () => {
  const customer = sampleCustomer();
  const job = sampleJob({
    customer_id: customer.id,
    customer: { id: customer.id, name: customer.name },
  });
  const controller = createCustomerDetailController(customer.id, {
    async getCustomer() {
      return customer;
    },
    async listJobs(_token, params) {
      assert.equal(params.customerId, customer.id);
      assert.equal(Object.prototype.hasOwnProperty.call(params, "bucket"), false);
      return { items: [job], next_cursor: null };
    },
  });
  const result = await controller.bootstrap("token");
  assert.equal(result, "ok");
  const snap = controller.getSnapshot();
  assert.equal(snap.phase, "ready");
  assert.equal(snap.jobs.length, 1);
  assert.equal(snap.jobs[0]?.id, job.id);
  const row = presentJobRow(snap.jobs[0]!);
  assert.equal(row.pressable, false);
  assert.equal(row.id, job.id);
  controller.dispose();
});

test("Customer routes do not navigate to Job Detail", () => {
  const detail = customerDetailHref("cccccccc-cccc-4ccc-8ccc-000000000001");
  const edit = customerEditHref("cccccccc-cccc-4ccc-8ccc-000000000001");
  assert.equal(detail.pathname.startsWith("/(app)/customers"), true);
  assert.equal(edit.pathname.startsWith("/(app)/customers"), true);
  assert.equal(CUSTOMERS_LIST_HREF.includes("/jobs"), false);
  assert.equal(CUSTOMERS_NEW_HREF.includes("/jobs"), false);
  const row = presentJobRow(sampleJob());
  assert.equal(row.pressable, false);
  assert.equal("href" in row, false);
});

test("Customer list module does not import Jobs list state/controller", () => {
  const listSrc = readCustomerModule("customersList.ts");
  const sessionSrc = readCustomerModule("customersListSession.ts");
  for (const src of [listSrc, sessionSrc]) {
    assert.equal(src.includes("features/jobs"), false);
    assert.equal(src.includes("jobsList"), false);
    assert.equal(src.includes("createJobsList"), false);
    assert.equal(src.includes("JOBS_LIST"), false);
  }
});

test("Customer create/edit/archive/delete do not import Quote/Invoice modules", () => {
  const modules = [
    "createCustomerForm.ts",
    "editCustomerForm.ts",
    "customerArchive.ts",
    "customerDelete.ts",
    "customerDetail.ts",
  ];
  for (const name of modules) {
    const src = readCustomerModule(name);
    assert.equal(/from\s+['"][^'"]*quotes?['"]/.test(src), false, name);
    assert.equal(/from\s+['"][^'"]*invoices?['"]/.test(src), false, name);
    assert.equal(src.includes("features/quotes"), false, name);
    assert.equal(src.includes("features/invoices"), false, name);
    assert.equal(src.includes("features/ledger"), false, name);
    assert.equal(src.includes("features/approvals"), false, name);
  }
});

test("Customer public domain DTO key set remains stable", () => {
  const customer = sampleCustomer();
  assert.deepEqual(Object.keys(customer).sort(), [...CUSTOMER_PUBLIC_DTO_KEYS].sort());
});

test("active Customer list path defaults to state=active for picker consumers", () => {
  const path = buildListCustomersPath({});
  assert.match(path, /state=active/);
  assert.match(path, /^\/v1\/customers\?/);
});

test("archived Customers use distinct list state (excluded from active picker contract)", () => {
  const active = buildListCustomersPath({ state: "active" });
  const archived = buildListCustomersPath({ state: "archived" });
  assert.match(active, /state=active/);
  assert.match(archived, /state=archived/);
  assert.notEqual(active, archived);
});

test("Customer→Job relationship paths use customer id, not name/email", () => {
  const id = "cccccccc-cccc-4ccc-8ccc-0000000000bb";
  const jobsPath = buildListJobsPath({ customerId: id, limit: 10, cursor: null });
  assert.match(jobsPath, /customer_id=cccccccc-cccc-4ccc-8ccc-0000000000bb/);
  assert.equal(jobsPath.includes("Boundary"), false);
  assert.equal(jobsPath.includes("@"), false);
  const detail = customerDetailHref(id);
  assert.deepEqual(detail.params, { id });
});

test("Create Customer return-to-Create-Job uses shared id contract (no Jobs UI import in customerRoutes)", () => {
  const routesSrc = readCustomerModule("customerRoutes.ts");
  assert.equal(routesSrc.includes("features/jobs"), false);
  assert.equal(routesSrc.includes("jobRoutes"), false);
  const href = createJobReturnHrefWithSelectedCustomer(
    "cccccccc-cccc-4ccc-8ccc-0000000000cc",
    "Display Only",
  );
  assert.equal(href.pathname, CREATE_JOB_RETURN_PATHNAME);
  assert.equal(href.params.selectedCustomerId, "cccccccc-cccc-4ccc-8ccc-0000000000cc");
  assert.equal(href.params.selectedCustomerName, "Display Only");
});

test("Customer feature modules do not import S05 Jobs list or S06 picker controllers", () => {
  const forbidden = ["jobsListSession", "createJobsListController", "customerPicker", "jobRoutes"];
  for (const file of [
    "customerDetail.ts",
    "customersList.ts",
    "createCustomerForm.ts",
    "editCustomerForm.ts",
    "customerArchive.ts",
    "customerDelete.ts",
    "customerRoutes.ts",
  ]) {
    const src = readCustomerModule(file);
    for (const hint of forbidden) {
      assert.equal(src.includes(hint), false, `${file} → ${hint}`);
    }
  }
  // S06 picker is overlap under features/jobs — must not import Customer feature controllers.
  const picker = readFeature("jobs/customerPicker.ts");
  assert.equal(picker.includes("features/customers/"), false);
  assert.equal(picker.includes("customersListSession"), false);
});
