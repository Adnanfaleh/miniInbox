import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module.js';
import { WebhookTenantGuard } from './webhook-tenant.guard.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

@Module({
  imports: [QueueModule],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookTenantGuard],
})
export class WebhookModule {}
