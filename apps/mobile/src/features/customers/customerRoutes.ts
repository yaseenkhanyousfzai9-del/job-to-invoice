/**
 * Canonical Expo Router paths for Customer screens.
 * File `app/(app)/customers/index.tsx` maps to `/(app)/customers` — never `/customers/index`.
 * File `app/(app)/customers/[id].tsx` maps to `/(app)/customers/{id}` — id only in the path.
 */
export const CUSTOMERS_LIST_HREF = "/(app)/customers" as const;
export const CUSTOMERS_NEW_HREF = "/(app)/customers/new" as const;

/** Resolved detail path: `/(app)/customers/{uuid}` — never put name/email in the URL. */
export function customerDetailHref(customerId: string): `/(app)/customers/${string}` {
  return `/(app)/customers/${customerId}`;
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

export function isInvalidCustomerDetailHref(href: string): boolean {
  return href.includes("/customers/index") || href.includes("/(app)/customers/index");
}
