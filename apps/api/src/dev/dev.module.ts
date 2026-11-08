import { Module } from '@nestjs/common';
import { WebhookTenantGuard } from '../webhook/webhook-tenant.guard.js';
import { ChannelController } from './channel.controller.js';
import { ChannelService } from './channel.service.js';
import { DevTenantsController } from './dev-tenants.controller.js';

/** Development-only routes (tenant picker, customer simulator channel). Each route refuses to work in production. */
@Module({
  controllers: [DevTenantsController, ChannelController],
  providers: [ChannelService, WebhookTenantGuard],
})
export class DevModule {}
