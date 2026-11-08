import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TENANT_HEADER, tenantIdSchema } from '@mini-inbox/contracts';
import { tenants } from '@mini-inbox/database';
import { PrismaService } from '../database/prisma.service.js';
import { TenantContext } from './tenant-context.service.js';
import { DEV_NO_TENANT, TENANT_FROM_WEBHOOK_URL } from './tenant-from-webhook-url.decorator.js';

interface HeaderBag {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * DEV STAND-IN, NOT AUTHENTICATION.
 *
 * Registered globally, so every route needs a verified tenant. The `x-tenant-id` header is untrusted input:
 * it is read here once, validated as a UUID, and checked against the tenants table. Only then is the tenant
 * stored in request context. Nothing downstream reads the header, the body or the URL for the tenant.
 *
 * Missing, malformed, repeated or unknown tenant → 404, the same answer as another tenant's resource,
 * so callers can't probe which tenants exist.
 *
 * Routes skipped: `@TenantFromWebhookUrl()` (handled by `WebhookTenantGuard`) and `@DevNoTenant()` (development tenant
 * picker, disabled in production).
 */
@Injectable()
export class TenantHeaderGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const fromWebhookUrl = this.reflector.getAllAndOverride<boolean>(TENANT_FROM_WEBHOOK_URL, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (fromWebhookUrl) return true;
    const devNoTenant = this.reflector.getAllAndOverride<boolean>(DEV_NO_TENANT, [context.getHandler(), context.getClass()]);
    if (devNoTenant) return true;

    const request = context.switchToHttp().getRequest<HeaderBag>();
    const parsed = tenantIdSchema.safeParse(request.headers[TENANT_HEADER]);
    if (!parsed.success) throw new NotFoundException();
    const tenant = await tenants.findById(this.prisma.client, parsed.data);
    if (!tenant) throw new NotFoundException();
    this.tenantContext.setVerifiedTenant(tenant.id);
    return true;
  }
}
