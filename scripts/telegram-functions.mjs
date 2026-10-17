import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export function writeTelegramFunctions(root, scheduled = false) {
  const directory = path.join(root, 'netlify/functions');
  mkdirSync(directory, { recursive: true });
  // Function responses own their headers; static-site DENY/CSP remain unchanged.
  const html = readFileSync(path.join(root, 'dist/tg/index.html'), 'utf8');
  writeFileSync(
    path.join(directory, 'telegram-entry.mjs'),
    `export default async () => new Response(${JSON.stringify(html)}, {headers: {
    'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self' https://telegram.org; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'self'; form-action 'self'"
  }});\n`,
  );
  const scheduledPath = path.join(directory, 'telegram-dispatch.mjs');
  rmSync(scheduledPath, { force: true });
  if (!scheduled) return;
  writeFileSync(
    scheduledPath,
    `export const config = {schedule:'* * * * *'};
export default async () => {
 const origin = process.env.PUBLIC_ORIGIN;
 const secret = process.env.TELEGRAM_DISPATCH_SECRET;
 if (process.env.TELEGRAM_ENABLED !== 'true' || !origin || !secret) throw new Error('Telegram dispatch configuration unavailable');
 const target = new URL('/api/internal/telegram-dispatch', origin);
 if (target.protocol !== 'https:' || target.username || target.password) throw new Error('HTTPS origin required');
 const response = await fetch(target, {method:'POST',redirect:'error', headers:{Authorization:'Bearer '+secret}, signal:AbortSignal.timeout(26000)});
 if (!response.ok) throw new Error('Telegram dispatch unavailable');
 return new Response(null,{status:204});
};\n`,
  );
}
