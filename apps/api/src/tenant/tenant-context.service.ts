import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

export const TENANT_ID_KEY = 'tenantId';

/**
 * The verified tenant of the current request, held in request-scoped async context (nestjs-cls), so this
 * service stays a singleton with no shared mutable state. Only `TenantHeaderGuard` sets it.
 */
@Injectable()
export class TenantContext {
  constructor(private readonly cls: ClsService) {}

  /** Throws if no tenant was verified for this request. There is never a default tenant. */
  tenantId(): string {
    const id = this.cls.isActive() ? this.cls.get<string | undefined>(TENANT_ID_KEY) : undefined;
    if (!id) throw new InternalServerErrorException();
    return id;
  }

  /** @internal Called by TenantHeaderGuard only, after the tenant has been verified. */
  setVerifiedTenant(tenantId: string): void {
    this.cls.set(TENANT_ID_KEY, tenantId);
  }
}
