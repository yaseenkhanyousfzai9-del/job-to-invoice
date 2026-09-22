/**
 * Customer API / domain dependency-boundary tests.
 * Proves Customer routes stay independent of Quote/Invoice modules and FK rules
 * do not depend on Jobs UI.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { CUSTOMER_REFERENCED, type Customer } from "@job-to-invoice/domain";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";
import {
  CUSTOMER_PUBLIC_DTO_KEYS,
  assertCustomerPublicDto,
  createActiveCustomer,
  createWorkspaceOwner,
} from "./test-helpers/customerFixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ISSUER = "http://auth.test/customer-boundary/v1";
const AUDIENCE = "authenticated";

function readSrc(relative: string): string {
  return readFileSync(join(here, relative), "utf8");
}

async function createTestApp() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const harness = createMemoryAuthStore();
  const app = await buildApp({
    jwtVerifier: createStaticKeyVerifier({
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
    store: harness.store,
  });
  async function token(subject: string, email: string) {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }
  return { app, token, harness };
}

async function createJobForCustomer(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  customerId: string,
  jobId: string,
  title: string,
  idempotencyKey: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": idempotencyKey,
    },
    payload: {
      id: jobId,
      customer_id: customerId,
      title,
      no_site: true,
      mode: "quote",
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { data: { id: string; customer_id: string } }).data;
}

test("Customer route module does not import Jobs/Quote/Invoice route modules", () => {
  const src = readSrc("routes/customers.ts");
  assert.equal(src.includes("routes/jobs"), false);
  assert.equal(src.includes("routes/quotes"), false);
  assert.equal(src.includes("routes/invoices"), false);
  assert.equal(src.includes("routes/ledger"), false);
  assert.equal(src.includes("routes/approvals"), false);
});

test("Customer domain module does not import Job module (no domain cycle)", () => {
  const domainCustomer = readFileSync(
    join(here, "../../../packages/domain/src/customer.ts"),
    "utf8",
  );
  assert.equal(domainCustomer.includes('from "./job'), false);
  assert.equal(domainCustomer.includes("from './job"), false);
});

test("app registers Customer routes as a separate plugin from Jobs", () => {
  const appSrc = readSrc("app.ts");
  assert.match(appSrc, /registerCustomersRoute/);
  assert.match(appSrc, /registerJobsRoute/);
  assert.equal(appSrc.indexOf("registerCustomersRoute") < appSrc.indexOf("registerJobsRoute"), true);
});

test("Customer APIs work for list/create without Jobs UI contracts", async () => {
  const { app, token } = await createTestApp();
  const access = (
    await createWorkspaceOwner(app, token, {
      authSubject: "boundary-owner-a",
      email: "boundary-a@example.test",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000a1",
    })
  ).accessToken;

  const listed = await app.inject({
    method: "GET",
    url: "/v1/customers?state=active",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(listed.statusCode, 200);
  const listBody = listed.json() as { data: { items: Customer[] } };
  assert.ok(Array.isArray(listBody.data.items));

  const created = await createActiveCustomer(app, access, {
    name: "Boundary Active",
    email: "boundary-active@example.test",
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000a2",
  });
  assertCustomerPublicDto(created);
  assert.deepEqual(Object.keys(created).sort(), [...CUSTOMER_PUBLIC_DTO_KEYS].sort());

  const activeOnly = await app.inject({
    method: "GET",
    url: "/v1/customers?state=active",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(activeOnly.statusCode, 200);
  const items = (activeOnly.json() as { data: { items: Customer[] } }).data.items;
  assert.ok(items.some((row) => row.id === created.id));
  assert.ok(items.every((row) => row.archived_at === null));
  await app.close();
});

test("referenced delete depends on Job FK existence, not Jobs UI", async () => {
  const { app, token } = await createTestApp();
  const access = (
    await createWorkspaceOwner(app, token, {
      authSubject: "boundary-owner-b",
      email: "boundary-b@example.test",
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-0000000000b0",
    })
  ).accessToken;

  const customer = await createActiveCustomer(app, access, {
    name: "Referenced Boundary",
    idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-0000000000b1",
  });
  const job = await createJobForCustomer(
    app,
    access,
    customer.id,
    "bbbbbbbb-bbbb-4bbb-8bbb-0000000000b2",
    "FK Job",
    "bbbbbbbb-bbbb-4bbb-8bbb-0000000000b3",
  );
  assert.equal(job.customer_id, customer.id);

  const del = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": "bbbbbbbb-bbbb-4bbb-8bbb-0000000000b4",
    },
  });
  assert.equal(del.statusCode, 409);
  assert.equal((del.json() as { error: { code: string } }).error.code, CUSTOMER_REFERENCED);

  const still = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(still.statusCode, 200);
  await app.close();
});

test("customer-scoped jobs list uses customer_id query (shared contract), not customer name", async () => {
  const { app, token } = await createTestApp();
  const access = (
    await createWorkspaceOwner(app, token, {
      authSubject: "boundary-owner-c",
      email: "boundary-c@example.test",
      idempotencyKey: "cccccccc-cccc-4ccc-8ccc-0000000000c0",
    })
  ).accessToken;

  const customer = await createActiveCustomer(app, access, {
    name: "Scoped Name Unique",
    idempotencyKey: "cccccccc-cccc-4ccc-8ccc-0000000000c1",
  });
  const job = await createJobForCustomer(
    app,
    access,
    customer.id,
    "cccccccc-cccc-4ccc-8ccc-0000000000c2",
    "Scoped Job",
    "cccccccc-cccc-4ccc-8ccc-0000000000c3",
  );

  const byId = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(byId.statusCode, 200);
  const items = (
    byId.json() as { data: { items: Array<{ id: string; customer_id: string }> } }
  ).data.items;
  assert.ok(items.some((row) => row.id === job.id));
  assert.ok(items.every((row) => row.customer_id === customer.id));
  await app.close();
});
