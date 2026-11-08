import { Global, Module } from '@nestjs/common';
import { apiEnvSchema, loadEnv, type ApiEnv } from '@mini-inbox/config';

/** Injection token for the validated API environment. */
export const API_ENV = 'API_ENV';
export type { ApiEnv };

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: (): ApiEnv => loadEnv(apiEnvSchema) }],
  exports: [API_ENV],
})
export class ApiConfigModule {}
