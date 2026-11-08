import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { API_ENV, type ApiEnv } from './config/api-env.js';
import { configureHttp } from './http.js';

async function bootstrap(): Promise<void> {
  // ApiConfigModule validates the environment on startup and fails fast, listing variable names only.
  // The default body parser is off so configureHttp can set explicit size limits.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  configureHttp(app);
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  const env = app.get<ApiEnv>(API_ENV);
  await app.listen(env.API_PORT);
  logger.log(`API listening on port ${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
