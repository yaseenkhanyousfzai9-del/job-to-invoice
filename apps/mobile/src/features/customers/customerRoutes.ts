/**
 * Canonical Expo Router paths for Customer screens.
 * File `app/(app)/customers/index.tsx` maps to `/(app)/customers` — never `/customers/index`.
 * File `app/(app)/customers/[id]/index.tsx` maps to pathname `/(app)/customers/[id]` with `{ id }` param.
 * File `app/(app)/customers/[id]/edit.tsx` maps to pathname `/(app)/customers/[id]/edit`.
 *
 * Create Job (`/(app)/jobs/new`) is **not** Customer-owned (S06 / Team B reconciliation).
 * Customer create may return to that route via the documented param contract below only.
 */
export const CUSTOMERS_LIST_HREF = "/(app)/customers" as const;
export const CUSTOMERS_NEW_HREF = "/(app)/customers/new" as const;

/**
 * Shared navigation contract: after creating a Customer from the Create Job picker flow
 * (`returnTo=create-job`), return with selection by **Customer.id** (+ name for display).
 * Does not import Jobs UI/controllers. Team B may change the Create Job screen as long as
 * these query params remain honored (or an equivalent selection API is adopted).
 */
export const CREATE_JOB_RETURN_PATHNAME = "/(app)/jobs/new" as const;

export type CreateJobReturnHref = {
  pathname: typeof CREATE_JOB_RETURN_PATHNAME;
  params: {
    selectedCustomerId: string;
    selectedCustomerName: string;
  };
};

export function createJobReturnHrefWithSelectedCustomer(
  customerId: string,
  customerName: string,
): CreateJobReturnHref {
  return {
    pathname: CREATE_JOB_RETURN_PATHNAME,
    params: {
      selectedCustomerId: customerId,
      selectedCustomerName: customerName,
    },
  };
}

/** FlatList must deliver row presses while the search keyboard is open (Android). */
export const CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS = "always" as const;

export type CustomerDetailHref = {
  pathname: "/(app)/customers/[id]";
  params: { id: string };
};

export type CustomerEditHref = {
  pathname: "/(app)/customers/[id]/edit";
  params: { id: string };
};

/**
 * Typed detail target: pathname + id param only (never name/email in the URL).
 * Prefer this over interpolating a raw path string for Expo Router dynamic segments.
 */
export function customerDetailHref(customerId: string): CustomerDetailHref {
  return {
    pathname: "/(app)/customers/[id]",
    params: { id: customerId },
  };
}

export function customerEditHref(customerId: string): CustomerEditHref {
  return {
    pathname: "/(app)/customers/[id]/edit",
    params: { id: customerId },
  };
}

export function customersListHrefWithCreatedFlag(): {
  pathname: typeof CUSTOMERS_LIST_HREF;
  params: { customerCreated: "1" };
} {
  return {
    pathname: CUSTOMERS_LIST_HREF,
    params: { customerCreated: "1" },
  };
}

export function isInvalidCustomersListHref(href: string): boolean {
  return href.includes("/customers/index") || href.includes("/(app)/customers/index");
}

export function isInvalidCustomerDetailHref(target: CustomerDetailHref | string): boolean {
  if (typeof target === "string") {
    return target.includes("/customers/index") || target.includes("/(app)/customers/index");
  }
  return (
    target.pathname.includes("/index") ||
    Object.keys(target.params).some((key) => key !== "id")
  );
}

export function isInvalidCustomerEditHref(target: CustomerEditHref | string): boolean {
  if (typeof target === "string") {
    return target.includes("/customers/index") || target.includes("/(app)/customers/index");
  }
  return (
    target.pathname.includes("/index") ||
    Object.keys(target.params).some((key) => key !== "id")
  );
}

/** Pure navigation helper — unit-testable without mounting the list screen. */
export function pushCustomerDetail(
  push: (href: CustomerDetailHref) => void,
  customerId: string,
): void {
  const href = customerDetailHref(customerId);
  push(href);
}

export function pushCustomerEdit(
  push: (href: CustomerEditHref) => void,
  customerId: string,
): void {
  push(customerEditHref(customerId));
}
