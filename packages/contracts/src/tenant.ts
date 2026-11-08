import { z } from 'zod';

/**
 * DEV STAND-IN, NOT AUTHENTICATION (D-008, D-017).
 * The caller names its tenant in this header. The API treats it as untrusted input: it validates it,
 * checks that the tenant exists, and stores the result in request context once. Nothing else reads it.
 * The replacement with real staff login is a pending decision.
 */
export const TENANT_HEADER = 'x-tenant-id';

export const tenantIdSchema = z.uuid();
