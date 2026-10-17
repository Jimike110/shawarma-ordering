import { spawnSync } from 'node:child_process';
import { writeTelegramFunctions } from './telegram-functions.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
writeTelegramFunctions(root, process.env.TELEGRAM_DISPATCH_SCHEDULED === 'true');
run(
  'go',
  [
    'build',
    '-trimpath',
    '-ldflags=-s -w',
    '-o',
    path.join(root, 'netlify/functions/api'),
    './cmd/netlify',
  ],
  {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' },
  },
);
console.log('Frontend and Linux Go function compiled. No deployment performed.');
