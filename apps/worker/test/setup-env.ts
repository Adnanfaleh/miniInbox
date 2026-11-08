// Runs before every worker test file. Test database (as app_user), test queue prefix, and NO real AI key:
// tests always use the MOCK provider and never call the Anthropic API.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.QUEUE_PREFIX = 'mini-inbox-test';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
// One job at a time makes ordering and priority observable.
process.env.WORKER_CONCURRENCY = '1';
