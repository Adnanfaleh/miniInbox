import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AiRouter } from './ai/ai-router.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  // WorkerConfigModule validates the environment on startup and fails fast, listing variable names only.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // SIGTERM/SIGINT: Nest runs onModuleDestroy, which waits for running jobs and closes the connections.
  app.enableShutdownHooks();
  logger.log(`Worker started (AI provider: ${app.get(AiRouter).providerName})`, 'Bootstrap');
}

void bootstrap();
