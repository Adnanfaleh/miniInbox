import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { inboundMessageSchema, type InboundMessage, type InboundMessageAccepted } from '@mini-inbox/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TenantFromWebhookUrl } from '../tenant/tenant-from-webhook-url.decorator.js';
import { WebhookTenantGuard } from './webhook-tenant.guard.js';
import { WebhookService } from './webhook.service.js';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhook: WebhookService) {}

  /**
   * Inbound customer message. The tenant is read from `:tenantId` by WebhookTenantGuard (existence check only)
   * and taken from request context from then on; the handler never reads the URL or body for it.
   * 202 means "stored and queued". The AI reply is produced by the worker.
   */
  @Post(':tenantId/message')
  @HttpCode(HttpStatus.ACCEPTED)
  @TenantFromWebhookUrl()
  @UseGuards(WebhookTenantGuard)
  receive(@Body(new ZodValidationPipe(inboundMessageSchema)) body: InboundMessage): Promise<InboundMessageAccepted> {
    return this.webhook.receive(body);
  }
}
