/**
 * Canonical Expo Router paths for Customer screens.
 * File `app/(app)/customers/index.tsx` maps to `/(app)/customers` — never `/customers/index`.
 * File `app/(app)/customers/[id].tsx` maps to pathname `/(app)/customers/[id]` with `{ id }` param.
 */
export const CUSTOMERS_LIST_HREF = "/(app)/customers" as const;
export const CUSTOMERS_NEW_HREF = "/(app)/customers/new" as const;

/** FlatList must deliver row presses while the search keyboard is open (Android). */
export const CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS = "always" as const;

export type CustomerDetailHref = {
  pathname: "/(app)/customers/[id]";
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

/** Pure navigation helper — unit-testable without mounting the list screen. */
export function pushCustomerDetail(
  push: (href: CustomerDetailHref) => void,
  customerId: string,
): void {
  const href = customerDetailHref(customerId);
  push(href);
}
