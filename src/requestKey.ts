// getRandomValues is available on HTTP LAN previews as well as HTTPS.
export function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
