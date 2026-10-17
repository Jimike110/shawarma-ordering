# Deployment and upgrades

This guide explains what must happen before a release and how the existing demonstration deployment is configured. It does not deploy anything.

## Deployment boundaries

| Environment | Purpose | Current approach |
| --- | --- | --- |
| Local development | Code changes and manual development | Docker Compose + Vite |
| Disposable review | Automated tests and synthetic demonstrations | Separate Compose project and tmpfs database |
| Hosted demonstration | Demonstrate the application | Existing GitHub + Netlify frontend/Go function + Neon |
| Real-data production | Serve the business and its customers | Infrastructure locations and operational arrangements must be separately approved |

Use one repository, deployment and database per business. Multiple stores of that business share its deployment. Never share production credentials/data with another business or a public preview.

The known demonstration URL is <https://shawarma-ordering.netlify.app>. This documentation is not a live availability report. A previously reported combination of healthy database ping and failing data endpoints, together with unapplied hosted migrations, points to checking the deployed schema first.

## Production launch gates

Before real customer/staff data is used:

- Confirm the operator's legal/payment details and approved privacy documents.
- Verify Russian production processing/storage locations, including logs, backups, support access and contractors; see [privacy operations](PRIVACY_OPERATIONS.md).
- Approve hosting, ownership of accounts/domain, costs, access and support arrangements.
- Back up and rehearse migrations on an isolated database.
- Create the owner and real staff assignments; test permissions and session persistence.
- Confirm the actual menu, address, hours, availability, ingredients/allergens and contact route.
- Verify checkout, exact retries, private tracking and kitchen fulfilment together.
- Configure restricted encrypted backups, independent journal storage, restoration, maintenance and external alerts.
- Agree the launch date only after readiness checks pass.

The supplied Docker/server components can be used in a separately designed hosting arrangement, but the repository does not provision Russian production infrastructure, TLS ingress, a scheduler or alerting. Do not publish Vite as a production service.

Netlify/Neon demonstration configuration does not resolve those requirements.

## Safe upgrade sequence

1. Identify the intended environment, database, current application version and migration ledger.
2. Arrange a maintenance window where needed. Retain the previous application artifacts and a protected backup.
3. Rehearse against isolated data, including privacy journal replay when applicable.
4. Run migrations explicitly against the target before publishing code that needs them.
5. Publish matching frontend/backend artifacts together.
6. Verify data endpoints, authentication, authorization and an isolated/approved smoke order.
7. Reopen traffic only when the checks pass.

`schema_migrations` records `schema.sql` and subsequent migrations. Add migrations; do not edit already-applied ones. Migration `003_access.sql` maps old data to original store 1 and revokes legacy shared sessions. Migration `004_privacy.sql` adds privacy structures and blocks new intake until document publication. It does not activate cleanup.

Do not treat rolling back frontend files as a database rollback. Restoring an old snapshot also needs the [privacy restore gate](PRIVACY_OPERATIONS.md#restore-without-resurrecting-erased-data).

## Existing Netlify and Neon demonstration

### Repository and build

The root [netlify.toml](../netlify.toml) defines:

| Setting | Value |
| --- | --- |
| Base | Repository root |
| Build command | `npm run build:netlify` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node toolchain | 22 |
| Go toolchain | 1.25.5 |

[scripts/build-netlify.mjs](../scripts/build-netlify.mjs) checks TypeScript, builds React assets and compiles a Linux amd64 Go function named `api`. The `/api/*` redirect preserves the route suffix; other paths return the React entry point for direct navigation.

A local build does not publish:

```text
npm ci
npm run check
npm run build:netlify
```

The Linux function binary cannot be run directly on Windows.

GitHub checks and Netlify automatic publishing are separate. The build script does not run the whole test suite or apply migrations. Configure provider/branch release gates explicitly; a push can publish code even if another CI job later fails.

### Database connection URLs

Use the Neon **pooled TLS URL** for the function runtime. Use its **direct TLS URL** for migrations, backups and administrative maintenance.

Both are supplied to their respective process as `DATABASE_URL`. There is no automatic `DIRECT_DATABASE_URL` setting. Preserve provider TLS options; do not disable TLS to fix an unset environment variable.

The API pool is capped at four open connections per warm instance; serverless scaling can multiply that number.

A fresh schema seeds demo content. Deployed images/JSON do not automatically populate a hosted catalogue. Choose either a reviewed restore into an empty target or fresh migrations followed by [public menu/settings transfer](MENU_SOURCE.md#transfer-current-public-settings-and-menu). Do not restore a full dump over an already initialized target as a routine import.

### Run explicit migrations

Direct Go does not load the root `.env`. Netlify's runtime environment is also separate from your terminal.

**Git Bash/MINGW64**, starting at the root:

```bash
read -r -s -p "Target direct database URL: " DATABASE_URL
printf '\n'
export DATABASE_URL
cd backend
go run ./cmd/migrate
cd ..
# Keep DATABASE_URL only if performing the reviewed owner step next.
unset DATABASE_URL
```

Enter the URL only, not a `psql` command or `DATABASE_URL=` prefix.

**PowerShell**, starting at the root:

```powershell
$targetDatabase = Read-Host "Target direct database URL" -AsSecureString
$env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $targetDatabase).Password
Push-Location backend
go run ./cmd/migrate
Pop-Location
Remove-Item Env:DATABASE_URL
$targetDatabase.Dispose()
```

Stop if migration fails. Do not paste connection URLs into chat or retain them in command history. Migration success proves the schema command completed, not the entire hosted release.

### Owner administration

The owner is stored in the target PostgreSQL database. There is no password in frontend configuration.

Export the target direct `DATABASE_URL` securely as above, then run from the root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\staff-admin.ps1 -Hosted
```

This prompts for a hidden personal owner password and creates `owner / Владелец`. If the owner already exists and recovery is intended:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\staff-admin.ps1 -Hosted -Mode recovery -Username owner
```

Remove the exported URL when finished. The hosted switch runs the Go CLI on your computer; it does not call a public registration/recovery endpoint.

For Bash, with the target URL exported, from `backend/`:

```bash
read -r -s -p "New owner password: " owner_password
printf '\n'
printf '%s\n' "$owner_password" | go run ./cmd/staff-admin -mode bootstrap -username owner -name 'Владелец'
unset owner_password
```

Use `-mode recovery` only for a reviewed recovery. The command receives the password on stdin; do not put it in arguments.

Legacy named bcrypt accounts can be imported with `staff-admin -mode import` and deliberately supplied `STAFF_USERS`. They become workers at original store 1 and require a password change. Shared environment kitchen passwords do not authenticate runtime users.

### Runtime settings

Configure these in Netlify's **Production environment**, with **Functions runtime scope**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Target pooled TLS URL |
| `SESSION_SECRET` | Business's stable random key, at least 32 characters |
| `PUBLIC_ORIGIN` | Exact HTTPS origin, no path/trailing slash |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `false`; the adapter uses provider client identity |
| `ORDER_RETENTION_DAYS` | `0` or unset; legacy deletion is retired |

Keep `AUTO_MIGRATE` unset/disabled for functions; the adapter does not migrate. Do not add a temporary `/tmp` deletion journal and call it durable independent storage. Privacy administration requiring that journal needs an appropriate persistence design.

The local `.env` and build-only variables do not provide runtime secrets. Netlify documents that function environment changes require a new deployment and that `netlify.toml` variables do not supply function runtime values. [Function environment documentation](https://docs.netlify.com/build/functions/environment-variables/)

Disable previews or give them a separate empty/sanitized database and matching origin. Do not expose production data through a preview branch or reuse production function secrets there.

### Platform lifecycle

The current adapter uses Lambda compatibility mode. Netlify states that deployments using that mode will no longer be accepted from **1 July 2027**. Rechecked on 16 October 2026. A runtime migration decision is required; the modern JavaScript compatibility wrapper is not established here as a drop-in replacement for the Go binary. [Official lifecycle notice](https://docs.netlify.com/build/functions/lambda-compatibility/)

## Verify a deployed release

Check the intended environment, not localhost:

1. `/api/health`, `/api/stores`, `/api/privacy` and a published store's menu.
2. Direct navigation/reload for `/orders`, `/kitchen` and owner routes.
3. HTTPS cookies, refresh/cold-start persistence, logout and role/store isolation.
4. Exact approved menu/photos/prices and number-only/consented checkout.
5. Lost-response retry without duplicates and tracking that reveals no optional personal fields.
6. Kitchen status/ETA/availability/pause, owner stops and existing-order fulfilment.
7. Backup restoration, independent deletion journal, maintenance schedule and alert destinations.

Use synthetic or explicitly approved smoke data. Browser storage belongs to an origin: localhost baskets/history do not automatically move to a new domain.

Functions do not run the standalone server's hourly maintenance loop or Compose backup service. Arrange those jobs externally. Polling creates repeated requests; measure actual provider usage instead of assuming a free plan will always suffice.

## Trial kitchen cutover

Back up and rehearse migrations `005_kitchen_devices.sql`/`006_toppings.sql` on disposable data before upgrading the API/frontend together. Create shared store access through the owner dashboard, approve retained devices, and review/disable obsolete individual worker accounts explicitly. Do not delete historical actors. Back up the Android signing key separately; install the [matching signed APK](../android-kitchen/README.md) without deploying an incompatible origin/backend combination.

The trial gate includes owner menu/branding approval, actual Teclast tests in both orientations and with the screen locked, and an operating-day soak. Check coverage with zero connected devices: it must warn while intake continues. All existing infrastructure/privacy/backup gates still apply. These repository changes do not authorize publishing documents, activating retention, deploying or changing production data.

## Troubleshooting

| Symptom | Likely check |
| --- | --- |
| Missing database URL / local socket / OS-user fallback | Correct runtime environment or export the intended CLI URL; do not use localhost URLs for hosted PostgreSQL |
| Health 200, data endpoints 500 | Pending migrations, wrong database/branch or code/schema mismatch |
| New API route 404 | Old deployed Go artifact or incorrect function routing |
| Empty/demo menu | Schema initialization is not the real-menu import |
| Login fails after legacy upgrade | Create/recover a database owner; environment shared passwords no longer work |
| Login lost on refresh | Cookie sent to correct HTTPS hostname/path, secure flag, session expiry or account revocation |
| Staff writes 403 | Exact Origin, role/store assignment or recent-password requirement |
| Privacy mutation fails | Independent writable journal and original stable key, not an ephemeral function directory |

Do not rotate `SESSION_SECRET` or reset a database merely to troubleshoot login. Keep private credentials/tokens out of logs and support messages.
