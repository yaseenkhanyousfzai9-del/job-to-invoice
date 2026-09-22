/**
 * Test-only Customer HTTP fixtures for memory (and injectable) Fastify apps.
 * Not a public API. Do not import from production routes.
 */
import type { FastifyInstance } from "fastify";

export type InjectApp = Pick<FastifyInstance, "inject">;

export type TokenFn = (
  subject: string,
  email: string,
) => Promise<string>;

export type CustomerPublic = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: unknown;
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export const CUSTOMER_PUBLIC_DTO_KEYS = [
  "id",
  "name",
  "email",
  "phone",
  "billing_address",
  "archived_at",
  "version",
  "created_at",
  "updated_at",
] as const;

export const CUSTOMER_INTERNAL_FIELDS = [
  "workspace_id",
  "normalized_email",
  "created_by",
] as const;

export function assertCustomerPublicDto(body: unknown): asserts body is CustomerPublic {
  if (body === null || typeof body !== "object") {
    throw new Error("Customer DTO must be an object");
  }
  const record = body as Record<string, unknown>;
  for (const key of CUSTOMER_PUBLIC_DTO_KEYS) {
    if (!(key in record)) {
      throw new Error(`Missing public Customer field: ${key}`);
    }
  }
  for (const key of CUSTOMER_INTERNAL_FIELDS) {
    if (key in record) {
      throw new Error(`Internal field leaked on Customer DTO: ${key}`);
    }
  }
}

export function defaultWorkspaceBody(suffix = "contract") {
  return {
    business_name: `Customer Contract ${suffix}`,
    legal_name: `Customer Contract ${suffix} LLC`,
    contact_name: "Contract Owner",
    contact_email: `contract-${suffix}@example.test`,
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

export function uuidFromSeed(prefix: string, n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `${prefix}-${hex}`;
}

export async function createWorkspaceOwner(
  app: InjectApp,
  token: TokenFn,
  options: {
    authSubject: string;
    email: string;
    idempotencyKey: string;
    workspaceBody?: ReturnType<typeof defaultWorkspaceBody>;
  },
): Promise<{ accessToken: string }> {
  const accessToken = await token(options.authSubject, options.email);
  const res = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": options.idempotencyKey,
    },
    payload: options.workspaceBody ?? defaultWorkspaceBody(options.authSubject),
  });
  if (res.statusCode !== 200) {
    throw new Error(`workspace create failed: ${res.statusCode} ${res.body}`);
  }
  return { accessToken };
}

export async function createActiveCustomer(
  app: InjectApp,
  accessToken: string,
  options: {
    name: string;
    email?: string | null;
    phone?: string | null;
    confirmDuplicateEmail?: boolean;
    idempotencyKey: string;
  },
): Promise<CustomerPublic> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": options.idempotencyKey,
    },
    payload: {
      name: options.name,
      email: options.email === undefined ? null : options.email,
      phone: options.phone === undefined ? null : options.phone,
      billing_address: null,
      confirm_duplicate_email: options.confirmDuplicateEmail === true,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`create customer failed: ${res.statusCode} ${res.body}`);
  }
  const data = (res.json() as { data: CustomerPublic }).data;
  assertCustomerPublicDto(data);
  return data;
}

export async function archiveCustomer(
  app: InjectApp,
  accessToken: string,
  customerId: string,
  archived: boolean,
  idempotencyKey: string,
): Promise<CustomerPublic> {
  const res = await app.inject({
    method: "POST",
    url: `/v1/customers/${customerId}/archive`,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "idempotency-key": idempotencyKey,
    },
    payload: { archived },
  });
  if (res.statusCode !== 200) {
    throw new Error(`archive failed: ${res.statusCode} ${res.body}`);
  }
  const data = (res.json() as { data: CustomerPublic }).data;
  assertCustomerPublicDto(data);
  return data;
}

export async function createArchivedCustomer(
  app: InjectApp,
  accessToken: string,
  options: {
    name: string;
    email?: string | null;
    createKey: string;
    archiveKey: string;
  },
): Promise<CustomerPublic> {
  const created = await createActiveCustomer(app, accessToken, {
    name: options.name,
    email: options.email ?? null,
    idempotencyKey: options.createKey,
  });
  return archiveCustomer(app, accessToken, created.id, true, options.archiveKey);
}

export type MemoryJobHarness = {
  createJob: (input: {
    workspaceId: string;
    customerId: string;
    createdBy: string;
    title: string;
    id?: string;
  }) => Promise<{ id: string; customer_id: string }>;
};

/** Creates an active Customer and a same-workspace Job (memory harness). */
export async function createCustomerWithJob(
  app: InjectApp,
  accessToken: string,
  harness: MemoryJobHarness,
  options: {
    workspaceId: string;
    createdBy: string;
    customerName: string;
    jobTitle: string;
    customerKey: string;
    jobId?: string;
  },
): Promise<{ customer: CustomerPublic; job: { id: string; customer_id: string } }> {
  const customer = await createActiveCustomer(app, accessToken, {
    name: options.customerName,
    idempotencyKey: options.customerKey,
  });
  const job = await harness.createJob({
    workspaceId: options.workspaceId,
    customerId: customer.id,
    createdBy: options.createdBy,
    title: options.jobTitle,
    ...(options.jobId !== undefined ? { id: options.jobId } : {}),
  });
  return { customer, job };
}

/** Second owner + Customer in another workspace (cross-tenant fixtures). */
export async function createCrossWorkspaceCustomer(
  app: InjectApp,
  token: TokenFn,
  options: {
    authSubject: string;
    email: string;
    workspaceKey: string;
    customerKey: string;
    customerName: string;
  },
): Promise<{ accessToken: string; customer: CustomerPublic }> {
  const { accessToken } = await createWorkspaceOwner(app, token, {
    authSubject: options.authSubject,
    email: options.email,
    idempotencyKey: options.workspaceKey,
    workspaceBody: defaultWorkspaceBody(options.authSubject),
  });
  const customer = await createActiveCustomer(app, accessToken, {
    name: options.customerName,
    idempotencyKey: options.customerKey,
  });
  return { accessToken, customer };
}
