import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { API_ENV, ApiConfigModule, type ApiEnv } from '../config/api-env.js';
import { TENANT_ID_KEY } from '../tenant/tenant-context.service.js';

/**
 * Structured logs that carry IDs, never content (CLAUDE.md 4.3 item 6, multi-tenant-isolation logging rules).
 * - Every line gets tenantId and requestId from request context.
 * - Requests are logged as method + path + status only: no headers, query strings or bodies.
 * - Redaction is a second line of defence for anything that slips through.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ApiConfigModule],
      inject: [ClsService, API_ENV],
      useFactory: (cls: ClsService, env: ApiEnv) => ({
        pinoHttp: {
          level: env.NODE_ENV === 'test' ? 'silent' : 'info',
          // The CLS middleware runs first and assigns the request ID; reuse it so every line shares one ID.
          genReqId: () => (cls.isActive() ? cls.getId() : randomUUID()),
          mixin: () => (cls.isActive() ? { tenantId: cls.get<string | undefined>(TENANT_ID_KEY) } : {}),
          serializers: {
            req: (req: { id?: string; method?: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              path: req.url?.split('?')[0],
            }),
            res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.body',
              '*.text',
              '*.from',
              '*.externalRef',
              '*.displayName',
              '*.email',
              '*.phone',
              '*.apiKey',
              '*.password',
            ],
            censor: '[redacted]',
          },
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
