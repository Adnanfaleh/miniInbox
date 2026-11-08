// `pnpm --filter @mini-inbox/config check-env` validates .env against every app's schema.
// Prints variable names and pass/fail only, never values.
import { apiEnvSchema, loadEnv, migrationEnvSchema, webEnvSchema, workerEnvSchema } from './env.js';

const schemas = { api: apiEnvSchema, worker: workerEnvSchema, web: webEnvSchema, migrations: migrationEnvSchema };

let failed = false;
for (const [name, schema] of Object.entries(schemas)) {
  try {
    loadEnv(schema);
    console.log(`ok    ${name}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${name}\n${(err as Error).message}`);
  }
}

const aiModelSet = Boolean(process.env.AI_MODEL);
console.log(`note  AI_MODEL is ${aiModelSet ? 'set' : 'not set (the worker will use the MOCK provider)'}`);
console.log(`note  ANTHROPIC_API_KEY is ${process.env.ANTHROPIC_API_KEY ? 'set' : 'not set'}`);
process.exit(failed ? 1 : 0);
