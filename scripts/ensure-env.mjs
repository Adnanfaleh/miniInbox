// Creates .env from .env.example on first run so `pnpm bootstrap` works on a fresh clone.
// It never overwrites an existing .env. .env holds secrets and is gitignored.
import { copyFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env exists, leaving it unchanged');
} else {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example. Set ANTHROPIC_API_KEY in .env before using real AI replies.');
}
