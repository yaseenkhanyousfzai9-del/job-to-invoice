import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CREATE_JOB_HREF,
  JOBS_LIST_HREF,
  JOBS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS,
  isInvalidCreateJobHref,
  isInvalidJobDetailHref,
  isInvalidJobsListHref,
  pushCreateJob,
  pushJobsList,
} from "./jobRoutes";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../../../app");
const shellPath = join(appDir, "(app)", "index.tsx");

test("owner shell Jobs entry targets canonical Jobs route", () => {
  assert.equal(JOBS_LIST_HREF, "/(app)/jobs");
  assert.equal(JOBS_LIST_HREF.includes("/index"), false);
  assert.equal(isInvalidJobsListHref(JOBS_LIST_HREF), false);
  const shell = readFileSync(shellPath, "utf8");
  assert.match(shell, /label="Jobs"/);
  assert.match(shell, /JOBS_LIST_HREF/);
});

test("Jobs list route file exists", () => {
  assert.equal(existsSync(join(appDir, "(app)", "jobs", "index.tsx")), true);
  assert.equal(existsSync(join(appDir, "(app)", "jobs", "_layout.tsx")), true);
});

test("Jobs nested layout registers list and new; no Job Detail [id]", () => {
  const layout = readFileSync(join(appDir, "(app)", "jobs", "_layout.tsx"), "utf8");
  assert.match(layout, /name="index"/);
  assert.match(layout, /name="new"/);
  assert.equal(layout.includes('name="[id]"'), false);
  assert.equal(existsSync(join(appDir, "(app)", "jobs", "[id]")), false);
});

test("New job navigation targets /(app)/jobs/new", () => {
  assert.equal(CREATE_JOB_HREF, "/(app)/jobs/new");
  assert.equal(isInvalidCreateJobHref(CREATE_JOB_HREF), false);
  assert.equal(existsSync(join(appDir, "(app)", "jobs", "new.tsx")), true);
  const calls: string[] = [];
  pushCreateJob((href) => {
    calls.push(href);
  });
  assert.deepEqual(calls, [CREATE_JOB_HREF]);
});

test("pushJobsList uses canonical href", () => {
  const calls: string[] = [];
  pushJobsList((href) => {
    calls.push(href);
  });
  assert.deepEqual(calls, [JOBS_LIST_HREF]);
});

test("Job Detail routes are rejected as invalid for S05", () => {
  assert.equal(isInvalidJobDetailHref("/(app)/jobs/[id]"), true);
  assert.equal(
    isInvalidJobDetailHref("/(app)/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    true,
  );
});

test("keyboardShouldPersistTaps is always for Jobs list", () => {
  assert.equal(JOBS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS, "always");
});
