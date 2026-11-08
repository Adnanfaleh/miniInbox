import { Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { tenantIdSchema } from '@mini-inbox/contracts';
import { tenants } from '@mini-inbox/database';
import { PrismaService } from '../database/prisma.service.js';
import { TenantContext } from '../tenant/tenant-context.service.js';

interface ParamBag {
  params: Record<string, string | undefined>;
}

/**
 * Tenant source for the inbound webhook only (applicant decision; CLAUDE.md section 4.3 exception).
 * The tenant is the one the customer chose, named in the URL. It is checked for existence only: securing the
 * customer source (signed webhooks) is out of scope for the MVP. Unknown or malformed → 404.
 * Once verified, the tenant goes into request context and the rest of the request is scoped as usual.
 */
@Injectable()
export class WebhookTenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ParamBag>();
    const parsed = tenantIdSchema.safeParse(request.params.tenantId);
    if (!parsed.success) throw new NotFoundException();
    const tenant = await tenants.findById(this.prisma.client, parsed.data);
    if (!tenant) throw new NotFoundException();
    this.tenantContext.setVerifiedTenant(tenant.id);
    return true;
  }
}
