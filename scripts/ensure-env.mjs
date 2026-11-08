// Creates .env from .env.example on first run so `pnpm bootstrap` works on a fresh clone.
// It never overwrites existing values. .env holds secrets and is gitignored.
// It also makes sure WEB_SESSION_SECRET holds a random value (never the committed placeholder).
import { randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const PLACEHOLDER = 'replace-me-with-a-random-string-of-at-least-32-chars';
const secret = () => randomBytes(32).toString('base64url');

if (existsSync('.env')) {
  console.log('.env exists, leaving existing values unchanged');
} else {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example. Set ANTHROPIC_API_KEY in .env before using real AI replies.');
}

const current = readFileSync('.env', 'utf8');
if (current.includes(`WEB_SESSION_SECRET=${PLACEHOLDER}`)) {
  writeFileSync('.env', current.replace(`WEB_SESSION_SECRET=${PLACEHOLDER}`, `WEB_SESSION_SECRET=${secret()}`));
  console.log('Generated WEB_SESSION_SECRET in .env');
} else if (!/^WEB_SESSION_SECRET=/m.test(current)) {
  appendFileSync('.env', `${current.endsWith('\n') ? '' : '\n'}WEB_SESSION_SECRET=${secret()}\n`);
  console.log('Added a generated WEB_SESSION_SECRET to .env');
}
