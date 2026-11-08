// Prisma CLI configuration (Prisma 7). Used only by migrate/generate commands, never by the apps.
// Migrations run as the owner role (MIGRATION_DATABASE_URL). The apps connect as app_user (DATABASE_URL).
// Set DB_TARGET=test to migrate the test database instead (TEST_MIGRATION_DATABASE_URL).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

// Load the repo-root .env. Variables already set in the environment win.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const urlVar = process.env.DB_TARGET === 'test' ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env(urlVar) },
});
