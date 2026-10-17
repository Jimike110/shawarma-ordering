# Telegram customer Mini App

The customer app is also available under `/tg/`. It uses the same menu, store baskets, pricing and kitchen as the website. Telegram customers still pay at pickup. Optional messages cover **accepted, ready and cancelled** orders only; there are no customer profiles, cross-device history, marketing messages or website-to-bot subscriptions.

The feature is **off by default**. Adding the migration does not connect a bot, publish privacy documents, enable cleanup or deploy anything.

Apply additive migration **`008_telegram.sql`** to the intended backed-up database before running the matching API. Rehearse it on disposable data first. Follow the existing [release/migration procedure](docs/DEPLOYMENT.md); do not point local setup at the production database. The standalone server can apply migrations when explicitly configured; Netlify functions do not migrate automatically.

## Configuration

Export these variables for the Go API; secrets must never use a `VITE_` prefix or appear in chat, URLs, screenshots or committed files. Normal Compose forwards them from local configuration. Direct Go commands do not read `.env` automatically.

| Variable | Value |
| --- | --- |
| `TELEGRAM_ENABLED` | `true` only in the explicitly prepared environment; otherwise `false` |
| `TELEGRAM_BOT_USERNAME` | BotFather username without `@`, such as your own separate test bot |
| `TELEGRAM_BOT_TOKEN` | Token issued by BotFather, server-side only |
| `TELEGRAM_WEBHOOK_SECRET` | Independent random 32+ character string using letters/digits/`_`/`-` |
| `TELEGRAM_DISPATCH_SECRET` | Another independent random 32+ character string |
| `TELEGRAM_DISPATCH_SCHEDULED` | Netlify **build-time** opt-in to package the minute scheduler; default `false` |
| `PUBLIC_ORIGIN` | Exact HTTPS origin for the environment, without path/trailing slash |
| `PRIVACY_JOURNAL_PATH` | Writable protected absolute journal path outside database snapshots |

Keep the existing stable `SESSION_SECRET`. Generate new secrets for an isolated installation, not as a way to reset an existing shop.

## Separate test bot and local test site

1. In the official **@BotFather**, create a separate test bot with `/newbot`. Keep its token locally. Never point the business bot at a test database.

   Create the separate ignored configuration from the repository root; the helper prompts for the token with hidden input and refuses to overwrite an existing file:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-telegram-test.ps1 -BotUsername YOUR_TEST_BOT
   ```

2. Prepare a disposable **`shawarma-review`** environment with a built nginx frontend and synthetic orders. The automated stack and commands are described in [testing](docs/TEST_RESULTS.md). **Before exposing it through a tunnel**, replace its deliberately public fixture owner password, `SESSION_SECRET` and database password with fresh random test values. Use `compose.e2e.yaml` plus `compose.telegram-test.yaml` and `--env-file artifacts/telegram-test.env`; the override requires independent test secrets. Stop the disposable stack before switching credentials, since its database is tmpfs. Never expose the unmodified e2e credentials. Keep `.env`, Vite, database ports and the normal shop containers private.
3. Start the separate services with `docker compose -p shawarma-review --env-file artifacts/telegram-test.env -f compose.e2e.yaml -f compose.telegram-test.yaml up -d --build db api web`. Bootstrap a new owner using the generated `TELEGRAM_TEST_OWNER_PASSWORD` through the existing CLI's stdin; do not reuse the e2e fixture password. Expose only the built web service: either use a localhost-only web port with `cloudflared tunnel --url http://localhost:5183`, or run Cloudflare's container on `shawarma-review_default` with URL `http://web:80`. The temporary free hostname is public and has no uptime SLA. Do not route it to port 5173 or Vite. [Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
4. Set the isolated API's `PUBLIC_ORIGIN` to that HTTPS hostname and `COOKIE_SECURE=true`. Supply the test-bot variables and independent test journal, then recreate **only the isolated API**. A normal restart does not reload environment values. Use the same HTTPS origin to log into its kitchen.

   The test override creates a protected, independent Linux journal volume through its one-shot `journal-init` service. Keep it with that test installation's signing key and database; do not transplant it into another installation. If Cloudflare cannot reach its edge from the current network, a free [localhost.run HTTPS tunnel](https://localhost.run/docs/) or [Pinggy HTTPS tunnel](https://pinggy.io/docs/http_tunnels/) can target `127.0.0.1:5183` instead. Do not use personal SSH keys or an SSH agent: use anonymous access where supported, or a disposable key and known-hosts file under ignored `artifacts/`. Approve the actual test provider in the synthetic disclosures. These tunnels are temporary test infrastructure, not production hosting.

   Check both `/tg/` and `/api/telegram/config` from the tester's phone before debugging Telegram authentication. A tunnel can work from the development machine while failing from another network. After a hostname changes, recreate the isolated API **and web service** (nginx must resolve the replacement API), update the bot, and use the button in a fresh `/start` reply; existing messages retain their old URLs. Pinggy's free browser confirmation page requires the tester to press **Enter** once; programmatic webhook requests are not screened. Its free tunnel expires after approximately one hour. See [Pinggy screening](https://pinggy.io/docs/http_tunnels/screening/).

   Pinggy can also return confirmation HTML with HTTP 200 to cookie-free browser API requests, causing **«Сервер вернул некорректный ответ»**. Its documented `X-Pinggy-No-Screen: 1` header prevents this. If needed, add that header through a same-origin API transport adapter mounted only into the isolated test frontend; keep provider-specific adapters under ignored `artifacts/`, outside the application build. Preserve `credentials: 'omit'` for Telegram authentication instead of making it depend on the tunnel's cookie.
5. In its owner privacy workspace, review a **synthetic** operator draft. Explicitly enable Telegram documents, fill recipients/locations, save, review and publish. Publication still does not activate retention. A missing journal/configuration or an older publication keeps Telegram ordering unavailable. Never copy fictional details into a real operator's documents.
6. Export the same test bot token and webhook secret in a local terminal. From the repository root run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\telegram-bot.ps1 -Origin https://YOUR-TEST-HOST.trycloudflare.com
   ```

   The script explicitly configures the webhook and **«Заказать»** menu. It reads process environment, not `.env`, and sanitizes errors. Bot messages use direct Mini App buttons, including recipient-protected status buttons. Optionally configure the **Main Mini App** to `https://YOUR-TEST-HOST.trycloudflare.com/tg/` in BotFather for `startapp` links. Set the permitted website domain if BotFather requests it.
7. Open the test bot, send `/start`, tap **«Заказать»**, choose a pickup point and place a synthetic order. Test opt-in and refusal separately. Move the order through the isolated kitchen while the Mini App is closed. Test `/stop`, blocking, reconnection and reopening status links. Only consenting testers may receive messages.
8. When finished, run the same script with `-RemoveWebhook` (also resets its temporary menu), stop the tunnel and stop the isolated stack. A changed tunnel hostname needs new origin/menu/webhook configuration (and Main Mini App configuration if enabled).

Store-specific chat links use `https://t.me/YOUR_BOT?start=s_STORE_ID`. The resulting **«Заказать»** button opens that published store; invalid/draft/archived stores open the picker. Optional Main Mini App links also accept `startapp=s_STORE_ID`.

The repository cannot create a bot without its owner using BotFather. Automated fake-Bot-API tests do not prove live delivery, mobile-network reachability or native Telegram behaviour. Android, iOS, desktop and Telegram Web must each be checked where available.

## Dispatch and hosting

The long-lived Go server attempts delivery after successful checkout/status commits and drains queued jobs every minute when Telegram is enabled. The same bounded dispatcher is available from `backend/` as `go run ./cmd/telegram-dispatch`, against an explicitly exported target database. Docker images also contain `telegram-dispatch`.

Netlify cannot rely on post-response goroutines. `npm run build:netlify` packages the recovery adapter **only** with `TELEGRAM_DISPATCH_SCHEDULED=true`. The scheduled adapter calls `POST /api/internal/telegram-dispatch` with its dedicated secret. A published deployment is needed for automatic schedules; previews do not establish scheduled execution. Keep it off until quota consumption and live recovery have been verified. A minute schedule adds approximately **43,200 scheduled invocations per 30 days**, plus dispatch API calls, and can keep the database active. [Netlify schedule documentation](https://docs.netlify.com/build/functions/scheduled-functions/)

Jobs are leased, deduplicated by order/event, retried with backoff and Telegram `retry_after`, and suppressed when their message is obsolete. One business-wide lease limits concurrent senders. Runs process at most ten jobs with one-second spacing; inspect backlog before increasing traffic. A lost Telegram response can still produce a duplicate message. Sending failures never roll back an order or kitchen status. There is no guarantee of delivery, sound or reading.

`GET /api/owner/telegram/health` is owner-only and exposes queue counts, oldest pending job, last dispatch/success and sanitized error codes. `delivery_401` suggests a token/configuration problem; `delivery_429` indicates throttling; transport errors use `delivery_0`. Unsubscribe and blocking stop outstanding messages; unblocking does not restore subscriptions.

Netlify serves `/tg/*` through a generated HTML-only function so it can supply a narrow Telegram framing policy without changing the existing static site's DENY/CSP. It reads no customer records. Verify these headers on the eventual hosted release as well as nginx locally. The Telegram SDK is loaded only by the Telegram HTML entry.

## API and privacy behaviour

- `GET /api/telegram/config`: username/readiness only.
- `POST /api/telegram/session`: signed raw `init_data`; returns a memory-only, hashed-on-server customer bearer token, valid at most 30 minutes. Launch data must be at most one hour old, with 60 seconds of allowed clock skew. It grants no staff permissions.
- `POST /api/telegram/checkout-intents`: bearer token, `request_key`, `store_id`, `consent_version`, `accepted:true`; returns a one-hour `intent_id`.
- `POST /api/orders`: optional `telegram:{intent_id}` for alerts, or `telegram:{}` for number-only Telegram checkout. Freeze this with the entire existing payload/key. The Authorization header is not persisted. Accepted identical retries return the existing order even when the Telegram session, intent or publication has expired; they cannot change recipients.
- `GET/DELETE /api/telegram/orders/{handle}`: verified recipient-only safe status/unsubscribe. A handle is not sufficient authorization. No order-list endpoint exists. A missing, wrong-recipient or expired handle returns the same unavailable response.
- `POST /api/telegram/webhook`: secret-header protected, known private messages/membership events only; full updates are not stored.

Published Telegram consent is separate from optional name/comment consent. Old published documents remain immutable. The owner must explicitly include Telegram disclosures and approve actual recipients/locations; enabling an environment variable cannot substitute for publication.

Recipient/order mappings and identifying delivery records expire seven days after actual completion/cancellation. Access is denied immediately at that boundary; physical deletion uses the existing **explicitly activated** journalled privacy-maintenance process. Active orders are exempt. Preview now includes `telegram_mappings`. Short-lived sessions, intents and webhook deduplication records also enter security cleanup. Continue the existing hourly maintenance schedule; Netlify dispatch is not a replacement for privacy maintenance.

Verified privacy exports include the recipient identifier. Erasing optional order data also removes its Telegram association and queued messages without cancelling the order. Explicit unsubscribe, `/stop` and bot blocking journal deletion using order IDs, never raw Telegram IDs. Restore with traffic blocked and replay the independent current journal before reopening. The existing signed journal wire format is unchanged.

Browser private receipts/history retain their separate one-year lifecycle. The application does not import Telegram profile details. Removing application records cannot erase Telegram messages, forwards or screenshots. Business bot ownership, approved documents, lawful infrastructure/data flows, backups and hosted scheduler acceptance remain real-data launch gates; this integration is not a compliance certification.

The official SDK normally caches signed launch/profile data in `__telegram__initParams`. The Telegram HTML loads a narrowly scoped storage guard before the SDK to prevent that cache while preserving baskets, frozen attempts and ordinary storage. Launch credentials stay in memory. A hard reload can therefore require reopening Telegram for authenticated status/alerts; number-only ordering and accepted retries remain available. Do not remove this guard to make SDK reloads appear seamless.
