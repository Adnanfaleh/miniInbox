import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx, type WithTenantOptions } from '@mini-inbox/database';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from '../tenant/tenant-context.service.js';

/**
 * How API code reaches tenant data. Takes the tenant from the verified request context (never from input),
 * opens a short tenant-scoped transaction (RLS context + bounded timeouts), and passes both to `fn`.
 * Pass the provided `tenantId` to every repository call.
 */
@Injectable()
export class TenantDb {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  run<T>(fn: (tx: TenantTx, tenantId: string) => Promise<T>, options?: WithTenantOptions): Promise<T> {
    const tenantId = this.tenantContext.tenantId();
    return withTenant(this.prisma.client, tenantId, (tx) => fn(tx, tenantId), options);
  }
}
