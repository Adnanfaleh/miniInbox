import { SetMetadata } from '@nestjs/common';

export const TENANT_FROM_WEBHOOK_URL = 'tenantFromWebhookUrl';

/**
 * Marks the inbound webhook, the one route whose tenant comes from the URL (`:tenantId`) instead of the
 * `x-tenant-id` header (applicant decision; CLAUDE.md section 4.3 exception). The header guard skips such
 * routes, and `WebhookTenantGuard` must be applied to them to verify the tenant and set the context.
 */
export const TenantFromWebhookUrl = () => SetMetadata(TENANT_FROM_WEBHOOK_URL, true);

export const DEV_NO_TENANT = 'devNoTenant';

/**
 * DEV STAND-IN ONLY: marks a development route that runs without a tenant (the tenant picker). The header
 * guard skips it; the route itself must refuse to work outside development.
 */
export const DevNoTenant = () => SetMetadata(DEV_NO_TENANT, true);
