/**
 * Customer fixture cleanup safety — memory registry tests (no live DB writes).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CustomerFixtureScope,
  MemoryCustomerFixtureRegistry,
} from "./test-helpers/customerLiveFixtures.ts";

test("cleanup still runs when test body throws (finally)", () => {
  const registry = new MemoryCustomerFixtureRegistry();
  const owner = "run-a";
  const customerId = "cccccccc-cccc-4ccc-8ccc-000000000001";
  const jobId = "jjjjjjjj-jjjj-4jjj-8jjj-000000000001";
  let cleanupInvoked = false;

  try {
    registry.create(owner, "customer", customerId);
    registry.create(owner, "job", jobId);
    assert.deepEqual(registry.aliveCount(owner), { customers: 1, jobs: 1 });
    throw new Error("simulated assertion failure");
  } catch (error) {
    assert.equal((error as Error).message, "simulated assertion failure");
  } finally {
    cleanupInvoked = true;
    registry.cleanupExact(owner, [jobId], [customerId]);
  }

  assert.equal(cleanupInvoked, true);
  assert.deepEqual(registry.aliveCount(owner), { customers: 0, jobs: 0 });
});

test("concurrent fixture scopes: cleaning A does not remove B", () => {
  const registry = new MemoryCustomerFixtureRegistry();
  const a = "run-a";
  const b = "run-b";
  const aCustomer = "cccccccc-cccc-4ccc-8ccc-0000000000aa";
  const aJob = "jjjjjjjj-jjjj-4jjj-8jjj-0000000000aa";
  const bCustomer = "cccccccc-cccc-4ccc-8ccc-0000000000bb";
  const bJob = "jjjjjjjj-jjjj-4jjj-8jjj-0000000000bb";

  registry.create(a, "customer", aCustomer);
  registry.create(a, "job", aJob);
  registry.create(b, "customer", bCustomer);
  registry.create(b, "job", bJob);

  registry.cleanupExact(a, [aJob], [aCustomer]);
  assert.deepEqual(registry.aliveCount(a), { customers: 0, jobs: 0 });
  assert.deepEqual(registry.aliveCount(b), { customers: 1, jobs: 1 });

  registry.cleanupExact(b, [bJob], [bCustomer]);
  assert.deepEqual(registry.aliveCount(), { customers: 0, jobs: 0 });
});

test("fixture scope refuses untracked customer/job cleanup ids", () => {
  const scope = new CustomerFixtureScope("abcd1234");
  scope.trackCustomer("cccccccc-cccc-4ccc-8ccc-000000000001");
  assert.throws(() => scope.assertOwnsCustomer("99999999-9999-4999-8999-999999999999"));
  assert.throws(() => scope.assertOwnsJob("jjjjjjjj-jjjj-4jjj-8jjj-000000000001"));
  scope.trackJob("jjjjjjjj-jjjj-4jjj-8jjj-000000000001");
  scope.assertOwnsJob("jjjjjjjj-jjjj-4jjj-8jjj-000000000001");
});

test("job-before-customer cleanup order on memory registry", () => {
  const registry = new MemoryCustomerFixtureRegistry();
  const owner = "order";
  const customerId = "cccccccc-cccc-4ccc-8ccc-0000000000cc";
  const jobId = "jjjjjjjj-jjjj-4jjj-8jjj-0000000000cc";
  registry.create(owner, "customer", customerId);
  registry.create(owner, "job", jobId);
  registry.cleanupOwner(owner);
  assert.deepEqual(registry.aliveCount(owner), { customers: 0, jobs: 0 });
});

test("cleanupExact refuses foreign-owned ids (pre-existing protection)", () => {
  const registry = new MemoryCustomerFixtureRegistry();
  registry.create("owner-a", "customer", "cccccccc-cccc-4ccc-8ccc-0000000000a1");
  registry.create("owner-b", "customer", "cccccccc-cccc-4ccc-8ccc-0000000000b1");
  assert.throws(() =>
    registry.cleanupExact("owner-a", [], ["cccccccc-cccc-4ccc-8ccc-0000000000b1"]),
  );
  assert.deepEqual(registry.aliveCount("owner-b"), { customers: 1, jobs: 0 });
});
