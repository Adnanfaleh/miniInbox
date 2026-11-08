import { Controller, Get, Header, Inject, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { channelThreadQuerySchema, type ChannelThreadQuery, type ChannelThreadResponse } from '@mini-inbox/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { API_ENV, type ApiEnv } from '../config/api-env.js';
import { TenantFromWebhookUrl } from '../tenant/tenant-from-webhook-url.decorator.js';
import { WebhookTenantGuard } from '../webhook/webhook-tenant.guard.js';
import { ChannelService } from './channel.service.js';

/**
 * DEV STAND-IN, NOT A REAL CHANNEL. Lets the local customer simulator (apps/customer-sim) read the replies to one
 * sender, the way WhatsApp or Instagram would deliver them. Like the webhook, the tenant comes from `:tenantId`
 * (existence check only) and the sender is not authenticated, so anyone who knows an address can read that
 * address's thread with that tenant. Read-only, customer-visible fields only, and 404 in production.
 */
@Controller('dev/channel')
export class ChannelController {
  constructor(
    private readonly channel: ChannelService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get(':tenantId/messages')
  @TenantFromWebhookUrl()
  @UseGuards(WebhookTenantGuard)
  @Header('Cache-Control', 'private, no-store')
  thread(@Query(new ZodValidationPipe(channelThreadQuerySchema)) query: ChannelThreadQuery): Promise<ChannelThreadResponse> {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    return this.channel.thread(query.from);
  }
}
