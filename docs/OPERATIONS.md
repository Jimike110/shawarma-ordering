# Running the shop

The app supports a single pickup location and payment at collection. Current kitchen settings use **Я@Ша**, **Белорусская ул., 4, Санкт-Петербург**, and **09:00–22:00 Moscow time**, interpreted as daily. `config/shop.json` retains the original Я люблю шаверму setup name; the README documents applying it locally and reviewing current staff edits first. The running shop uses the 19-item catalogue, prices, portion sizes, and local photos from the user-selected Yandex Maps listing; demo mode is disabled. See [menu source/import](MENU_SOURCE.md) before applying the catalogue to a fresh database. Missing contact details and complete ingredient/allergen information are explicitly left unset; staff must confirm current stock and any schedule exceptions.

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

## Named staff access

The existing kitchen password continues to work for local demos. For individual access, set `STAFF_USERS` to a JSON object of usernames and bcrypt hashes. All named accounts have the kitchen role; this app does not implement different permission levels. Names are attributed to product, settings, and order mutations in `audit_events`, in the same database transaction as the mutation.

Build the password hashing helper:

```powershell
cd backend
go build -o ../bin/hash-password.exe ./cmd/hash-password
cd ..
```

Enter a password through a secure prompt; pass it to the helper through stdin:

```powershell
$staffPassword = Read-Host 'New staff password' -AsSecureString
$staffCredential = [System.Net.NetworkCredential]::new('', $staffPassword)
$staffCredential.Password | .\bin\hash-password.exe
$staffCredential = $null
$staffPassword = $null
```

Store the returned hash in `.env` using single quotes around the complete JSON value so its dollar signs remain literal:

```dotenv
STAFF_USERS='{"anna":"PASTE_BCRYPT_HASH_HERE","maksim":"PASTE_SECOND_HASH_HERE"}'
```

With `STAFF_USERS` configured, the shared password no longer authenticates. Staff enter their username and password. Removing a user or changing their hash invalidates their previous session when the new configuration takes effect. Restart the API after a configuration change. Hashes must be valid bcrypt hashes; passwords are 12–72 UTF-8 bytes. Never place plain passwords in this JSON.

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

The default port binds to `127.0.0.1` for local use. A public domain/TLS termination layer and production database destination still need to be selected and configured. This work updates the local app; it does not create a cloud deployment.
