import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const child = spawn('go', ['run', './cmd/server'], {
  cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
  env: process.env,
  stdio: 'inherit',
});
child.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
