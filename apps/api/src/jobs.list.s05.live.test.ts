import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createPostgresAuthStore } from "./store/postgres.ts";

function liveDevelopmentApiUrl(): string | undefined {
  if (process.env["APP_ENV"] === "production" || process.env["APP_ENV"] === "staging") {
    return undefined;
  }
  const url = process.env["DATABASE_URL_API"];
  if (url === undefined || url.trim() === "") {
    return undefined;
  }
  return url;
}

const databaseUrl = liveDevelopmentApiUrl();

const ISSUER = "http://auth.test/s05-jobs-list/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `S05 Jobs Live ${suffix}`,
    legal_name: `S05 Jobs Live ${suffix} LLC`,
    contact_name: "S05 Owner",
    contact_email: `s05-jobs-list-${suffix}@example.test`,
    contact_phone: null,
    address: {
      line1: "100 Main St",
      line2: null,
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    timezone: "America/Chicago",
    trade: "handyman",
    default_tax_bp: 0,
    default_due_days: 14,
    default_terms: "",
  };
}

function uuidFromSeed(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `cccccccc-cccc-4ccc-8ccc-${hex}`;
}

async function cleanupOwner(sql: ReturnType<typeof postgres>, authUserId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;
    const users = await tx<{ id: string }[]>`
      select id from app.app_users where auth_user_id = ${authUserId} limit 1
    `;
    const userId = users[0]?.id;
    if (!userId) return;
    const workspaces = await tx<{ id: string }[]>`
      select id from app.workspaces where owner_user_id = ${userId}::uuid limit 1
    `;
    const workspaceId = workspaces[0]?.id;
    if (workspaceId) {
      await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
      await tx`delete from app.jobs where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.customers where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.job_allowances where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.memberships where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.workspaces where id = ${workspaceId}::uuid`;
    }
    await tx`delete from app.idempotency_records where actor_scope = ${userId}`;
    await tx`delete from app.app_users where id = ${userId}::uuid`;
  });
}

test("live GET /v1/jobs S05 buckets search DTO isolation on US development", {
  skip: databaseUrl === undefined,
}, async () => {
  assert.ok(databaseUrl, "DATABASE_URL_API required for live evidence");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const store = createPostgresAuthStore(databaseUrl);
  const app = await buildApp({
    jwtVerifier: createStaticKeyVerifier({
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
    store,
  });

  const authA = "s05-jobs-list-auth-a";
  const authB = "s05-jobs-list-auth-b";

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

  try {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);

    const accessA = await token(authA, "s05-jobs-list-a@example.test");
    const accessB = await token(authB, "s05-jobs-list-b@example.test");

    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/workspace",
          headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(1) },
          payload: workspaceBody("a"),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/workspace",
          headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(2) },
          payload: workspaceBody("b"),
        })
      ).statusCode,
      200,
    );

    const meA = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(meA.statusCode, 200);
    const workspaceA = (meA.json() as { data: { workspace: { id: string }; user: { id: string } } })
      .data;
    assert.ok(workspaceA.workspace?.id, "workspace A must exist");

    const customerA = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "S05 Search Smith" },
    });
    const customerB = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "S05 Search Smith" },
    });
    assert.equal(customerA.statusCode, 201);
    assert.equal(customerB.statusCode, 201);
    const custA = (customerA.json() as { data: { id: string; name: string } }).data;
    const custB = (customerB.json() as { data: { id: string } }).data;

    const lifecycles = [
      "draft",
      "active",
      "invoiced",
      "finished",
      "canceled",
      "archived",
    ] as const;
    for (let i = 0; i < lifecycles.length; i += 1) {
      const lifecycle = lifecycles[i]!;
      const id = uuidFromSeed(10 + i);
      await sql.begin(async (tx) => {
        await tx`select set_config('app.auth_user_id', ${authA}, true)`;
        await tx`select set_config('app.workspace_id', ${workspaceA.workspace.id}, true)`;
        await tx`
          insert into app.jobs (
            id, workspace_id, customer_id, title, lifecycle, no_site, created_by
          ) values (
            ${id}::uuid,
            ${workspaceA.workspace.id}::uuid,
            ${custA.id}::uuid,
            ${`S05 ${lifecycle} Title`},
            ${lifecycle},
            true,
            ${workspaceA.user.id}::uuid
          )
        `;
      });
    }

    await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authB}, true)`;
      const meB = await tx<{ workspace_id: string; user_id: string }[]>`
        select w.id as workspace_id, u.id as user_id
        from app.app_users u
        join app.workspaces w on w.owner_user_id = u.id
        where u.auth_user_id = ${authB}
        limit 1
      `;
      const b = meB[0]!;
      await tx`select set_config('app.workspace_id', ${b.workspace_id}, true)`;
      await tx`
        insert into app.jobs (
          id, workspace_id, customer_id, title, lifecycle, no_site, created_by
        ) values (
          ${uuidFromSeed(30)}::uuid,
          ${b.workspace_id}::uuid,
          ${custB.id}::uuid,
          'S05 Cross Kitchen',
          'draft',
          true,
          ${b.user_id}::uuid
        )
      `;
    });

    const defaultList = await app.inject({
      method: "GET",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(defaultList.statusCode, 200);
    const defaultBody = defaultList.json() as {
      data: { items: Array<{ lifecycle: string; customer: { id: string; name: string } }> };
    };
    assert.deepEqual(
      defaultBody.data.items.map((item) => item.lifecycle).sort(),
      ["active", "draft", "invoiced"],
    );
    for (const item of defaultBody.data.items) {
      assert.equal(item.customer.id, custA.id);
      assert.equal(item.customer.name, "S05 Search Smith");
      assert.equal("email" in item.customer, false);
    }

    const finished = await app.inject({
      method: "GET",
      url: "/v1/jobs?bucket=finished",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(finished.statusCode, 200);
    const finishedBody = finished.json() as { data: { items: Array<{ lifecycle: string }> } };
    assert.deepEqual(
      finishedBody.data.items.map((item) => item.lifecycle).sort(),
      ["canceled", "finished"],
    );

    const archived = await app.inject({
      method: "GET",
      url: "/v1/jobs?bucket=archived",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(archived.statusCode, 200);
    const archivedBody = archived.json() as { data: { items: Array<{ lifecycle: string }> } };
    assert.deepEqual(
      archivedBody.data.items.map((item) => item.lifecycle),
      ["archived"],
    );

    const titleSearch = await app.inject({
      method: "GET",
      url: "/v1/jobs?search=invoiced",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(titleSearch.statusCode, 200);
    const titleBody = titleSearch.json() as { data: { items: Array<{ title: string }> } };
    assert.equal(titleBody.data.items.length, 1);
    assert.equal(titleBody.data.items[0]?.title, "S05 invoiced Title");

    const nameSearch = await app.inject({
      method: "GET",
      url: "/v1/jobs?search=Search%20Smith",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(nameSearch.statusCode, 200);
    const nameBody = nameSearch.json() as {
      data: { items: Array<{ customer: { id: string } }> };
    };
    assert.equal(nameBody.data.items.length, 3);
    assert.equal(JSON.stringify(nameBody).includes(custB.id), false);
    assert.equal(JSON.stringify(nameBody).includes("S05 Cross Kitchen"), false);

    const scoped = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${custA.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(scoped.statusCode, 200);
    const scopedBody = scoped.json() as { data: { items: unknown[] } };
    assert.equal(scopedBody.data.items.length, 6);
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await store.close?.();
    await app.close();
    await sql.end({ timeout: 5 });
  }
});
