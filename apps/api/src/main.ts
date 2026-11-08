import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { API_ENV, type ApiEnv } from './config/api-env.js';

async function bootstrap(): Promise<void> {
  // ApiConfigModule validates the environment on startup and fails fast, listing variable names only.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  const env = app.get<ApiEnv>(API_ENV);
  await app.listen(env.API_PORT);
  logger.log(`API listening on port ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
