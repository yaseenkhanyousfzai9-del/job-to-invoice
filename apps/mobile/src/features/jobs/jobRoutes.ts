/**
 * Canonical Expo Router paths for Create Job (S06).
 * File `app/(app)/jobs/new.tsx` maps to `/(app)/jobs/new` — never `/jobs/new/index`.
 */
export const CREATE_JOB_HREF = "/(app)/jobs/new" as const;

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

/** After in-sheet Customer create from Create Job, return with selection. */
export function createJobHrefWithSelectedCustomer(
  customerId: string,
  customerName: string,
): CreateJobHref {
  return {
    pathname: CREATE_JOB_HREF,
    params: {
      selectedCustomerId: customerId,
      selectedCustomerName: customerName,
    },
  };
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

export function isInvalidCreateJobHref(href: string): boolean {
  return href.includes("/jobs/new/index") || href.includes("/(app)/jobs/new/index");
}
