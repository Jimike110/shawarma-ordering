import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const destination = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(destination)) {
  console.log('.env already exists; no changes made.');
  process.exit(0);
}
const db = randomBytes(24).toString('hex');
const secret = randomBytes(32).toString('hex');
writeFileSync(
  destination,
  [
    'POSTGRES_PASSWORD=' + db,
    'SESSION_SECRET=' + secret,
    'DATABASE_URL=postgres://shawarma:' + db + '@127.0.0.1:5432/shawarma?sslmode=disable',
    'PUBLIC_ORIGIN=http://localhost:5173',
    'COOKIE_SECURE=false',
    'AUTO_MIGRATE=true',
    'LISTEN_ADDR=:8080',
    '',
  ].join('\n'),
  { mode: 0o600 },
);
console.log(
  'Created .env with random local database and signing credentials. Bootstrap a staff owner after starting the app.',
);
console.log('Open http://localhost:5173/kitchen after starting the application.');
