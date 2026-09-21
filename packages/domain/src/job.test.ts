import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeJobListCursor, decodeJobListCursor } from "./job-list-cursor.ts";
import { parseCreateJobInput, parseJobListQuery, parseJobTitle } from "./job.ts";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function siteAddress() {
  return {
    line1: "500 Site Rd",
    line2: null,
    city: "Austin",
    state: "TX",
    zip: "78701",
  };
}

test("parseJobTitle trims and enforces VAL01 1–120", () => {
  assert.equal(parseJobTitle("  Fence repair  ").value, "Fence repair");
  assert.equal(parseJobTitle("").error !== undefined, true);
  assert.equal(parseJobTitle("x".repeat(121)).error !== undefined, true);
  assert.equal(parseJobTitle("現場工事").value, "現場工事");
});

test("parseCreateJobInput requires client UUID, customer, title, no_site, mode", () => {
  const created = parseCreateJobInput({
    id: JOB_ID,
    customer_id: CUSTOMER_ID,
    title: "  Patio  ",
    no_site: true,
    site_address: null,
    mode: "quote",
  });
  assert.equal(created.title, "Patio");
  assert.equal(created.no_site, true);
  assert.equal(created.site_address, null);
  assert.equal(created.mode, "quote");

  const withSite = parseCreateJobInput({
    id: JOB_ID,
    customer_id: CUSTOMER_ID,
    title: "Deck",
    no_site: false,
    site_address: siteAddress(),
    mode: "direct_invoice",
  });
  assert.equal(withSite.site_address?.line1, "500 Site Rd");
  assert.equal(withSite.mode, "direct_invoice");

  assert.throws(() =>
    parseCreateJobInput({
      id: JOB_ID,
      customer_id: CUSTOMER_ID,
      title: "X",
      no_site: true,
      site_address: siteAddress(),
      mode: "quote",
    }),
  );
  assert.throws(() =>
    parseCreateJobInput({
      id: JOB_ID,
      customer_id: CUSTOMER_ID,
      title: "X",
      no_site: false,
      mode: "quote",
    }),
  );
  assert.throws(() =>
    parseCreateJobInput({
      id: JOB_ID,
      customer_id: CUSTOMER_ID,
      title: "X",
      no_site: true,
      mode: "quote",
      workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
  );
  assert.throws(() =>
    parseCreateJobInput({
      id: JOB_ID,
      customer_id: CUSTOMER_ID,
      title: "X",
      no_site: true,
      mode: "quote",
      lifecycle: "active",
    }),
  );
});


test("job list cursor round-trips and binds customer filter", () => {
  const encoded = encodeJobListCursor({
    updated_at: "2026-09-20T00:00:00.000Z",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    state: "all",
    search: null,
  });
  const decoded = decodeJobListCursor(encoded, {
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    state: "all",
    search: null,
  });
  assert.equal(decoded.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("job list cursor rejects filter mismatch", () => {
  const encoded = encodeJobListCursor({
    updated_at: "2026-09-20T00:00:00.000Z",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    state: "all",
    search: null,
  });
  assert.throws(() =>
    decodeJobListCursor(encoded, {
      customer_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      state: "all",
      search: null,
    }),
  );
});

test("parseJobListQuery requires customer_id UUID and defaults state to all", () => {
  const parsed = parseJobListQuery({
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(parsed.customer_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(parsed.state, "all");
  assert.equal(parsed.limit, 25);
  assert.throws(() => parseJobListQuery({}));
  assert.throws(() => parseJobListQuery({ customer_id: "not-a-uuid" }));
  assert.throws(() => parseJobListQuery({ customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", workspace_id: "w" }));
});
