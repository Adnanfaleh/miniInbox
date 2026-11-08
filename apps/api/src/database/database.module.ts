import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantDb } from './tenant-db.service.js';

/**
 * Database access for the API. `TenantDb` is the only way feature code reaches tenant data: it scopes every
 * transaction to the tenant verified for the request (TenantContext comes from the global TenantModule).
 */
@Global()
@Module({
  providers: [PrismaService, TenantDb],
  exports: [PrismaService, TenantDb],
})
export class DatabaseModule {}
