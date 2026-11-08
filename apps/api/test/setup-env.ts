// Runs before every API test file (vitest setupFiles). Points the API under test at the test database (as
// app_user) and at a test-only queue prefix, so tests never touch development data or the development queue.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.QUEUE_PREFIX = 'mini-inbox-test';
process.env.NODE_ENV = 'test';
