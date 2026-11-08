import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { DatabaseExceptionFilter } from './common/database-exception.filter.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { PersonaModule } from './persona/persona.module.js';
import { DevModule } from './dev/dev.module.js';
import { ApiConfigModule } from './config/api-env.js';
import { DatabaseModule } from './database/database.module.js';
import { AppLoggerModule } from './logging/logger.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { WebhookModule } from './webhook/webhook.module.js';

/**
 * Root module. Request context (CLS), config, logging, database and the tenant context are global.
 * Every route is guarded by TenantHeaderGuard (dev stand-in, see tenant/tenant-header.guard.ts).
 * Feature modules: webhook and queue, conversations (read, takeover, reply), persona.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      // This ID is also used by pino-http as req.id (see logging/logger.module.ts): one ID per request.
      middleware: { mount: true, generateId: true, idGenerator: () => randomUUID() },
    }),
    ApiConfigModule,
    AppLoggerModule,
    DatabaseModule,
    TenantModule,
    WebhookModule,
    ConversationsModule,
    PersonaModule,
    DevModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DatabaseExceptionFilter }],
})
export class AppModule {}
