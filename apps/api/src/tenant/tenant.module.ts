import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TenantContext } from './tenant-context.service.js';
import { TenantHeaderGuard } from './tenant-header.guard.js';

@Global()
@Module({
  providers: [TenantContext, { provide: APP_GUARD, useClass: TenantHeaderGuard }],
  exports: [TenantContext],
})
export class TenantModule {}
