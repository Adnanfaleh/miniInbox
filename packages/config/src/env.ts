import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** Treats empty strings from .env (e.g. `AI_MODEL=`) as "not set". */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const database = z.object({
  /** Application role (app_user). Not the table owner, so row-level security applies (D-016). */
  DATABASE_URL: z.url(),
});

const redis = z.object({
  REDIS_URL: z.url(),
  /** BullMQ key prefix. Tests use their own prefix so they never touch the development queue. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes only')
    .default('mini-inbox'),
});

const ai = z.object({
  /** Read from the environment only (CLAUDE.md section 3). Never logged. */
  ANTHROPIC_API_KEY: optionalString,
  /** Pending decision: AI model name and provider policy. Deliberately has no default. */
  AI_MODEL: optionalString,
});

export const apiEnvSchema = base.extend({
  ...database.shape,
  ...redis.shape,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export const workerEnvSchema = base
  .extend({
    ...database.shape,
    ...redis.shape,
    ...ai.shape,
    /** Jobs processed at once per queue (inbound-message and ai-reply). */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  })
  // A real key needs an explicit model: there is no hidden default.
  .refine((e) => !e.ANTHROPIC_API_KEY || !!e.AI_MODEL, { path: ['AI_MODEL'], message: 'required when ANTHROPIC_API_KEY is set' });

export const webEnvSchema = base.extend({
  API_BASE_URL: z.url(),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export const migrationEnvSchema = base.extend({
  /** Owner role. Used only for migrations and seed. */
  MIGRATION_DATABASE_URL: z.url(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

/** Walks up from `start` to the folder holding pnpm-workspace.yaml (the repo root). */
export function findRepoRoot(start: string = process.cwd()): string | undefined {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads the repo-root .env into process.env, if present. Variables that are already set win,
 * so real environments can override the file.
 */
export function loadRootEnvFile(): void {
  const root = findRepoRoot();
  const file = root ? join(root, '.env') : undefined;
  if (file && existsSync(file)) process.loadEnvFile(file);
}

/**
 * Validates the environment against `schema` and fails fast with the names of the bad variables.
 * The error lists variable names only, never their values, so secrets can't leak into logs.
 */
export function loadEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  loadRootEnvFile();
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return result.data;
}
