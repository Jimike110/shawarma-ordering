# Running the shop

The app supports multiple pickup stores within one business and payment at collection. Current local kitchen settings, checked on 2026-10-10, use **Я@Ша**, **Белорусская ул., 4, Санкт-Петербург**, and daily **11:00–22:00 Moscow time**, with 10-minute preparation and a staff-filled phone number. Рыба-Фиш is unavailable. `config/shop.json` retains the original Я люблю шаверму name and 09:00 opening; review current staff edits before applying it. The running shop uses the 19-item catalogue, prices, portion sizes, and local photos from the user-selected Yandex Maps listing; demo mode is disabled. See [menu source/import](MENU_SOURCE.md) before applying the catalogue to a fresh database and the [hosted shop transfer](DEPLOYMENT.md#transfer-the-current-menu-and-shop-settings-into-a-fresh-hosted-database) to copy current public data to Neon. Full ingredient/allergen information is still unset; staff must confirm contact accuracy, current stock, and schedule exceptions.

## Daily operation

The current local frontend is in Vite hot-reload mode at the usual `localhost:5173`. Start it with both `compose.yaml` and `compose.vite.yaml`; the same database and daily backup service remain in use. See [development mode](DEVELOPMENT.md) for commands and intentionally switching back to nginx. The default nginx build remains the production serving path.

- Keep the kitchen page open on a powered device. Turn on sound after signing in; new orders also show a visible notice. Sound needs the browser to remain awake and does not deliver background push notifications.
- The queue retains every active order; it includes up to 300 orders closed in the last 24 hours. Oldest active orders appear first. Search uses the order number or guest name.
- Update preparation time when the kitchen is delayed. Overdue orders are highlighted. Cancel with a customer-facing reason when necessary; customers see that reason on their private status page.
- On an order, tapping **5 / 10 / 15 / 20 / 30 мин** immediately updates its ready time from now and shows confirmation. For a custom value, enter 1–120 minutes and tap **Применить**. Settings time buttons update the draft only; use **Сохранить настройки** to persist it.
- Tap new/preparing/ready counters to filter the queue. On phones, switch between orders/menu/settings through the bottom navigation. Availability switches in Menu change stock without opening the product editor. Cancellation suggestions only fill the reason; confirm cancellation explicitly.
- To repeat Monday's hours throughout the week, use **Как в понедельник — на всю неделю**, review the days, then save settings. This includes weekends and replaces their draft shifts.
- Set opening hours in Moscow time. Overnight shifts close on the following day. A checked schedule with no working days closes ordering. Manual pause overrides opening hours. Without a schedule, staff control intake using pause.
- Product options have stable IDs, labels, and an extra price in whole rubles; a zero price represents a free change. Historic receipts keep the selected labels and paid prices. Removing an option prevents new orders with it but does not change existing receipts.

## Staff access

Staff accounts live in PostgreSQL. Back up before migration `003_access.sql`; it removes legacy shared sessions while preserving original store data. After migration, run `./scripts/staff-admin.ps1` to create the first owner (hidden password prompt). See [upgrade instructions](../README.md#staff-accounts-and-upgrades), including explicit owner recovery and legacy bcrypt-account import.

Owners create accounts and assign manager/worker access per store through the dashboard. Temporary passwords expire after 24 hours and require a personal password at first login. Passwords are never displayed after issuance. Password resets, disabling accounts and assignment changes revoke existing sessions. Staff sessions last 12 hours and persist across refreshes and function restarts; sensitive owner changes require password confirmation within five minutes.

Workers handle orders, stock, preparation time and operational pauses. Managers also edit their store's products/settings and see reports. Only owners control accounts, publication/archival and owner stops. Operational pauses cannot override an owner stop. Existing orders remain available for fulfilment while intake is stopped.

## Backups

Start daily local backups alongside the app:

```powershell
docker compose --profile operations up -d --build
docker compose --profile operations ps
```

The backup service writes PostgreSQL custom-format archives to `backups/` immediately, then daily. It retains archives for 14 days, retries failures every minute, and verifies archive readability before marking success. Its health check reports unhealthy if no successful backup has completed within 25 hours. Backups contain customer data and session hashes; the directory is excluded from Git and Docker build contexts.

An on-demand backup:

```powershell
docker compose --profile operations run --rm backups --once
```

Local archives protect against an application mistake, but do not survive losing this computer or disk. Copy completed archives to an encrypted off-machine destination under your control. No external backup account has been connected by this change.

Test restoration into a separate database before relying on backups. Never restore over the shop database during routine verification:

```powershell
docker compose exec db createdb -U shawarma shawarma_restore_test
# Replace the filename with one from backups/. This copies into the database container.
docker compose cp ./backups/CHOSEN_ARCHIVE.dump db:/tmp/restore-check.dump
docker compose exec db pg_restore --exit-on-error --no-owner -U shawarma -d shawarma_restore_test /tmp/restore-check.dump
docker compose exec db psql -U shawarma -d shawarma_restore_test -c 'SELECT count(*) FROM orders;'
```

The restore check database is intentionally separate and can be removed by its operator afterward. Backups include the schema migration ledger. Application migrations run transactionally under a database lock, once per recorded version; they preserve staff edits and existing orders. Add a new migration file for future schema changes rather than editing an applied migration.

## Health, logs, and retention

`http://localhost:5173/api/health` checks database connectivity through the public web proxy. Compose health checks cover the database, API, web proxy, and optional backups. API failures and slow requests are logged without tracking URLs. The nginx API location suppresses access/error URL logs so bearer tracking tokens do not enter them; Go logs and health checks provide diagnostics.

```powershell
docker compose --profile operations ps
docker compose logs --tail 100 api backups
```

Expired sessions and rate-limit counters are cleaned at startup and every 24 hours by the standalone API. Closed-order deletion is disabled by default. Set `ORDER_RETENTION_DAYS` to 30–3650 to explicitly enable it; only orders already completed/cancelled and older than that many days since their last update are deleted. Active orders are never removed by this task. After deletion, old private links no longer resolve. Keep retention disabled if you still need those records. Audit events are retained until an operator sets a separate archival policy.

The Netlify function does not have a background maintenance loop; schedule database housekeeping externally for that deployment model. No external uptime alert service is configured. Before a public launch, choose an alert destination and monitor the deployed `/api/health` endpoint and backup health.

## Public deployment

Serve the site through HTTPS; set the exact `PUBLIC_ORIGIN`, `COOKIE_SECURE=true`, strong credentials, and a stable random session secret. Only nginx publishes a local port in the default Compose file. The Go service trusts the nginx client-IP header and remains private to the container network. Do not expose that API port directly while `TRUST_PROXY=true`.

The default port binds to `127.0.0.1` for local use. The selected hosted setup is a separate GitHub repository, Netlify site with Go functions, and Neon project per business. The user deployed `https://shawarma-ordering.netlify.app`; hosted database configuration and initial shop-data transfer still need verification. See [deployment instructions](DEPLOYMENT.md) for runtime secrets, current-data transfer, maintenance, launch checks, and the Go adapter's platform lifecycle constraint. The agent has not provisioned the cloud resources or applied the shop transfer to Neon.
