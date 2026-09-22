/**
 * Canonical Expo Router paths for Jobs screens (S05 list + S06 create).
 * File `app/(app)/jobs/index.tsx` maps to `/(app)/jobs` — never `/jobs/index`.
 * File `app/(app)/jobs/new.tsx` maps to `/(app)/jobs/new` — never `/jobs/new/index`.
 * S08 Job Detail is not implemented — do not invent `/jobs/[id]`.
 *
 * OVERLAP / REFERENCE ONLY — not Customer module ownership. Final Jobs ownership reconciles with Team B.
 * Customer create return selection uses the shared contract in `customerRoutes`
 * (`createJobReturnHrefWithSelectedCustomer`); this module re-exports the same shape for S06 callers.
 */
import {
  CREATE_JOB_RETURN_PATHNAME,
  createJobReturnHrefWithSelectedCustomer,
} from "../customers/customerRoutes";

export const JOBS_LIST_HREF = "/(app)/jobs" as const;
export const CREATE_JOB_HREF = CREATE_JOB_RETURN_PATHNAME;

/** FlatList must deliver filter / New job / Load more presses while search keyboard is open. */
export const JOBS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS = "always" as const;
export const CREATE_JOB_KEYBOARD_SHOULD_PERSIST_TAPS = "always" as const;

export type CreateJobHref = {
  pathname: typeof CREATE_JOB_HREF;
  params?: {
    selectedCustomerId?: string;
    selectedCustomerName?: string;
    jobCreated?: string;
  };
};

export function createJobHref(params?: CreateJobHref["params"]): CreateJobHref {
  if (params && Object.keys(params).length > 0) {
    return { pathname: CREATE_JOB_HREF, params };
  }
  return { pathname: CREATE_JOB_HREF };
}

/** After in-sheet Customer create from Create Job, return with selection (shared Customer contract). */
export function createJobHrefWithSelectedCustomer(
  customerId: string,
  customerName: string,
): CreateJobHref {
  return createJobReturnHrefWithSelectedCustomer(customerId, customerName);
}

export function customersNewHrefForCreateJob(): {
  pathname: "/(app)/customers/new";
  params: { returnTo: "create-job" };
} {
  return {
    pathname: "/(app)/customers/new",
    params: { returnTo: "create-job" },
  };
}

export function isInvalidJobsListHref(href: string): boolean {
  return href.includes("/jobs/index") || href.includes("/(app)/jobs/index");
}

export function isInvalidCreateJobHref(href: string): boolean {
  return href.includes("/jobs/new/index") || href.includes("/(app)/jobs/new/index");
}

export function isInvalidJobDetailHref(href: string): boolean {
  return (
    /\/jobs\/[0-9a-f-]{36}/i.test(href) ||
    href.includes("/jobs/[id]") ||
    href.includes("/(app)/jobs/[id]")
  );
}

/** Owner shell → Jobs list. */
export function pushJobsList(push: (href: typeof JOBS_LIST_HREF) => void): void {
  push(JOBS_LIST_HREF);
}

/** Jobs list → Create Job (S06). */
export function pushCreateJob(push: (href: typeof CREATE_JOB_HREF) => void): void {
  push(CREATE_JOB_HREF);
}
