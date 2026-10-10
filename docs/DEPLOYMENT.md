# Deployment: GitHub + Netlify + Neon, separately for each business

The user selected this setup on 2026-10-10:

| Part        | Setup for each business                                                 |
| ----------- | ----------------------------------------------------------------------- |
| Source code | Separate private GitHub repository, editable locally                    |
| Frontend    | React production build on a separate Netlify site in the user's account |
| Backend     | Go function adapter deployed with that Netlify site                     |
| Database    | Separate Neon project with its own credentials                          |

Each business has its own repository, Netlify site, Neon project, domain/origin, staff credentials, and session secret. Deploying or editing one business must not change another business's data or configuration. Local development continues to use the existing Docker/Vite workflow.

Local Git is initialized on `main`. The user supplied the deployed site `https://shawarma-ordering.netlify.app` on 2026-10-10. Its initial supplied logs showed PostgreSQL falling back to the Netlify sandbox user and a local `/tmp` socket instead of Neon. The user subsequently reports kitchen login followed by logout on refresh, suggesting the initial connectivity blocker has been addressed; the cross-instance session defect below was reproduced and fixed locally. Hosted configuration and menu transfer have not been independently verified. The agent has not provisioned these resources. Resources must belong to the user's accounts. Never put service tokens or database URLs into frontend code, Git, or chat messages.

**Go lifecycle constraint:** the current `backend/cmd/netlify` adapter uses Lambda compatibility mode. Netlify's current [official documentation](https://docs.netlify.com/build/functions/lambda-compatibility/?fn-language=go) says deployments containing that mode will stop being accepted on **July 1, 2027**. Treat the existing Go integration as a current deployment candidate requiring a live check and a migration decision before that date, not as a verified long-term solution. The modern TypeScript compatibility package is not a drop-in replacement for this Go binary. Do not silently replace the user's Go backend or hosting choice.

## 1. Create a repository

Create an empty repository in your own GitHub account and connect the local repository. The commands below describe a fresh setup; local Git is already initialized on `main`, so skip initialization/remote steps already completed and inspect existing configuration before changing it:

```powershell
git init
git add .
git commit -m "Build shawarma ordering MVP"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/shawarma-ordering.git
git push -u origin main
```

Check that `.env` is ignored before pushing. Source photos, lockfiles, tests, Compose, and build scripts should be committed. CI contains only disposable test credentials.

## 2. Create a separate Neon project for this business

Create a Neon project dedicated to this business and choose PostgreSQL 17 or newer. Select a region close to the Netlify function region where possible. Review the chosen plan's compute, connection, storage, and restore-history limits; this guide provisions nothing and assumes no particular paid/free entitlement.

Copy two TLS-enabled connection URLs from Neon into secure configuration:

- **Pooled URL:** use as `DATABASE_URL` for Netlify's function runtime. Neon pooled endpoint hostnames include `-pooler`. The current Go `database/sql` pool is capped at four connections per warm function instance; serverless scaling still multiplies application connections.
- **Direct URL:** use for explicit migrations, `pg_dump`/restore, and operator maintenance. Keep it outside the frontend and separate from runtime configuration. This project calls the direct URL `DATABASE_URL` only inside the operator's migration/backup process; it does not yet implement a separate automatic `DIRECT_DATABASE_URL` setting.

For example, a placeholder direct URL is `postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require`. Use the actual URL supplied by Neon without discarding its TLS options. See Neon's [pooling guidance](https://neon.com/blog/inside-lubots-database-per-tenant-architecture) for the pooled/direct distinction.

Choose the initial data before running migrations: either start clean and apply the approved menu/settings, or restore the existing shop backup into an empty target database first. Do not run a full restore into a database already populated by fresh migrations. Restored databases carry their migration ledger; the migration command below then applies only missing versions.

Apply the schema from a machine that can reach the chosen database:

Go does not automatically load the project's `.env`. Set `DATABASE_URL` in the shell that runs the migration; configuring it in Netlify does not set it on your computer. The database opener rejects empty/whitespace URLs instead of letting the PostgreSQL driver fall back to localhost and your OS username. If you see `user=Jimike database=` or a localhost TLS/authentication error, check that this variable was exported in the same terminal. Do not disable Neon TLS to fix a missing URL.

**Git Bash / MINGW64**, starting in `backend/`: copy only Neon's direct connection URL (not the surrounding `psql` command). The hidden prompt avoids putting the credential in shell history or terminal output.

```bash
read -r -s -p "Paste Neon direct connection URL: " DATABASE_URL
printf '\n'
export DATABASE_URL
go run ./cmd/migrate
unset DATABASE_URL
```

Keep the URL's TLS options such as `sslmode=require`. The final `unset` only clears the variable from this shell after the command.

**PowerShell**, starting in the project root:

```powershell
$env:DATABASE_URL = "YOUR_NEON_DIRECT_CONNECTION_URL"
cd backend
go run ./cmd/migrate
cd ..
```

PowerShell's `$env:DATABASE_URL = ...` syntax does not work in Git Bash; Bash uses `export`. Prefer a secure local prompt when setting real credentials, and never paste database URLs into chat.

The migration includes demo products and uses `ON CONFLICT DO NOTHING`; rerunning it does not replace staff product edits. The function does not run migrations on every request.

The running local shop already has the real 19-item menu and staff-edited settings. Before launch, explicitly choose between restoring that database into the new Neon project or initializing a clean database and applying the approved menu/settings. Do not assume source photos/config files populate Neon automatically, and do not reapply the original shop-name file over current staff edits. Preserve purchased receipt snapshots if transferring existing orders. Keep a pre-transfer backup and verify restored data before enabling customer traffic; see `OPERATIONS.md` and `MENU_SOURCE.md`.

### Transfer the current menu and shop settings into a fresh hosted database

Use this for an already-migrated Neon database with the initial demo catalogue. It transfers public shop data only, leaving hosted orders, sessions, credentials, and rate limits alone. It does not bring local test orders into production.

The latest local public API snapshot on 2026-10-10 has **19 products**, shop name **Я@Ша**, address **Белорусская ул., 4**, daily **11:00–22:00** shifts, **10-minute** preparation time, and a staff-filled phone number. **Рыба-Фиш** is unavailable. These current staff values supersede the original setup file's name and 09:00 opening time; do not reapply that older file blindly. The phone is copied as staff entered it, not independently verified.

1. Keep the local app running. From the repository root in Git Bash or PowerShell, generate a snapshot:

   ```bash
   docker compose -f compose.yaml -f compose.tools.yaml run --rm --no-deps frontend-tools node scripts/prepare-shop-transfer.mjs
   ```

   If Node 22 is installed locally, `node scripts/prepare-shop-transfer.mjs` also works. The script makes only one unauthenticated local menu request, checks all menu photo checksums, and writes `artifacts/shop-transfer.json` plus `artifacts/import-shop.sql`. It never connects to Neon or changes a database. The files are ignored by Git.

2. Review the JSON snapshot for current shop values and availability. The generator copies current product names/prices/descriptions/options rather than restoring older manifest values.
3. In the Neon project used by this Netlify site's `DATABASE_URL`, open **SQL Editor** and choose that same branch and database. Run migrations first if the application tables are missing. Review/back up any existing hosted data before applying the transfer.
4. Open `artifacts/import-shop.sql`, copy the complete file into the editor, and run it. The data-changing `DO` statement is atomic and contains no `psql` metacommands. The final verification queries should show 19 products on a fresh target and the reviewed shop settings.
5. Refresh the Netlify storefront. Database changes need no redeploy. If photos are missing, ensure `public/images/menu/` is committed and included in the deployed frontend build.

The import matches products by image path, adds missing products with new IDs, and removes only the three completely untouched demo fixtures. It preserves unrelated target products and all historic order receipts. An identical snapshot can be reapplied without changing product IDs. Target shop settings must still be bootstrap defaults (allowing the older catalogue import's demo/map changes), or already identical to the snapshot. Differing matching products or edited target settings cause an error before applying the import; review those differences instead of bypassing the checks. Once staff are using the hosted shop, make future edits in its kitchen panel rather than repeatedly importing local snapshots.

The artifact prepared in this workspace was verified against a disposable PostgreSQL 17 database, including forced rollback, repeated import, unchanged order snapshots, and conflicting target settings/product edits. It has **not** been applied to Neon.

## 3. Import the repository into Netlify

When you choose to deploy, connect that GitHub repository through Netlify's UI. The root `netlify.toml` already defines:

| Setting             | Value                   |
| ------------------- | ----------------------- |
| Base directory      | Repository root         |
| Build command       | `npm run build:netlify` |
| Publish directory   | `dist`                  |
| Functions directory | `netlify/functions`     |
| Node                | 22                      |
| Go build toolchain  | 1.25.5                  |

The build script produces a Linux amd64 Go binary called `api` and the React assets. A redirect sends `/api/*` to that function with the original path suffix. The function converts the event to a normal Go HTTP request and preserves session cookies.

Set these environment variables with the **Functions** runtime scope before using the app:

| Variable               | Value                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`         | TLS-enabled Neon pooled connection URL                                              |
| `KITCHEN_PASSWORD`     | A unique password, 12–72 UTF-8 bytes                                                |
| `SESSION_SECRET`       | At least 32 random characters; keep it stable                                       |
| `PUBLIC_ORIGIN`        | Exact origin, e.g. `https://YOUR_SITE.netlify.app`, with no trailing slash          |
| `COOKIE_SECURE`        | `true`                                                                              |
| `TRUST_PROXY`          | `false`; the adapter uses the provider's client identity, not arbitrary `X-Real-IP` |
| `ORDER_RETENTION_DAYS` | `0` until the user chooses a retention policy                                       |

If individual staff accounts are selected, configure `STAFF_USERS` as username-to-bcrypt-hash JSON rather than using shared access. The selected credentials/session secret are unique to this business. Redeploy after runtime configuration changes. Keep `AUTO_MIGRATE` disabled/unset for functions; run migrations explicitly using the direct connection.

Alternatively use `KITCHEN_PASSWORD_HASH` with a bcrypt hash instead of `KITCHEN_PASSWORD`. Secrets belong in Netlify environment settings, not in `netlify.toml`, the frontend, or GitHub source.

`PUBLIC_ORIGIN` intentionally permits exactly one origin for staff mutations. Store production database/staff secrets in the Production deploy context with Functions scope. Disable previews initially, or give them separately scoped credentials and an isolated empty/sanitized Neon preview branch/test database plus a matching origin. Never let preview deployments write to production data or expose a production-data clone. A separate Neon project per business is still required; preview branches are for environments within that one business.

You can verify the artifacts locally first:

```powershell
npm ci
npm test
npm run build:netlify
```

This builds only. It does not deploy. The Linux function binary is not executable directly on Windows.

### Troubleshooting: menu unavailable and a `/tmp/.s.PGSQL.5432` error

The deployed site reported `Сервис временно недоступен.` on 2026-10-10. Its `Function init:` logs included `user=sbx_user1051 database=` and a missing `/tmp/.s.PGSQL.5432` socket. These are PostgreSQL driver defaults, indicating that the function is not receiving the intended Neon connection configuration. Netlify does not host the local Compose PostgreSQL service.

1. Open the Netlify project's **Environment variables** settings and add or correct the exact key `DATABASE_URL`.
2. Paste only Neon's pooled connection URL, preserving its TLS options. Do not include a `psql` command, shell quotes, or a `DATABASE_URL=` prefix. Do not use the local Docker/localhost URL.
3. Apply the value to the **Production** deploy context. If scope controls are offered, include **Functions**; otherwise use the default all scopes. Build-only scope does not make the value available at runtime. Do not copy production database credentials to previews.
4. Save and trigger a new production deploy. Merely editing the variable does not change the function in an existing deployment.
5. Recheck `/api/health` and `/api/menu`, and review fresh function logs. If migrations have not been applied, run the explicit migration command above with Neon's direct URL. A migrated fresh database still needs the approved real menu/settings.

For this site, `PUBLIC_ORIGIN` must be `https://shawarma-ordering.netlify.app` with no trailing slash, and `COOKIE_SECURE` must be `true`. The local database opener now rejects blank `DATABASE_URL` values with an explicit diagnostic; deploy the updated source to get that diagnostic. This guard does not configure Netlify or populate Neon.

Netlify's [function environment documentation](https://docs.netlify.com/build/functions/environment-variables/) confirms that runtime scope must include Functions, variables in `netlify.toml` are unavailable to functions, and updated values require a new deploy. The local `.env` is not automatically loaded by this Go adapter.

## 4. Verify after your chosen deployment

### Troubleshooting: kitchen login disappears on reload

The user reported this on 2026-10-10. A reproduced backend defect affected shared access configured with `KITCHEN_PASSWORD`: every `LoadConfig()` generated a new salted bcrypt hash, and sessions stored a fingerprint of that hash. Another function/server instance therefore rejected the same password's session with HTTP 401. Keeping `SESSION_SECRET` stable did not fix that defect.

The corrected backend uses a stable HMAC identity derived from the shared password and session secret for session revocation, while bcrypt still checks login passwords. Explicit `KITCHEN_PASSWORD_HASH` and named `STAFF_USERS` retain their existing hash-based revocation. Publish the updated backend through the normal Git/Netlify deployment, then sign in once again; previous shared-password sessions use the old credential fingerprint. No database migration or data reimport is required. Keep the configured shared password and `SESSION_SECRET` stable across instances; changing either revokes shared-password sessions. The session lifetime remains 12 hours.

Local PostgreSQL regressions reproduce the old HTTP 401 and verify the fix across independently loaded configurations, protected order requests, password/secret changes, logout, and explicit-hash rotation. Live hosted behavior still needs checking after deployment. If reload still shows login, inspect the status of `GET /api/kitchen/session` and whether the `kitchen_session` cookie is sent, without sharing its value. HTTP 401 is an authentication failure; network/5xx failures indicate a separate service problem. Ensure HTTPS uses `COOKIE_SECURE=true` and remain on the same deployed hostname.

Open the menu, submit a test order, save its tracking link, sign in to the kitchen, and advance the order. Confirm that the open tracking page updates without a manual refresh. Test a paused shop and an unavailable product.

Also verify `/api/health`, direct/reloaded `/orders` and `/kitchen` routes, session cookies on HTTPS, logout, retry idempotency, exact menu prices/photos, and database reconnection after Neon idles. Run public checks only against the intended launch/test database. Browser history is origin-local: localhost's saved order links/cart do not automatically appear on the new domain.

The standalone API's daily maintenance loop and Compose backup container do not run inside Netlify functions. Arrange session/rate-counter maintenance, an explicit backup/restore policy, and external health monitoring before accepting live orders. Check the actual Neon plan's restore history and test restoration; local Docker backups alone do not protect the hosted database. Monitor Netlify function usage and Neon compute usage, since menu/order polling creates recurring requests.

## Netlify support limitation

As checked for this delivery on October 10, 2026, Netlify's documentation sends Go authors to the Lambda-compatible API. That page says Lambda compatibility deployments will no longer be accepted from July 1, 2027. This package therefore contains the current Go path, with that lifecycle limitation made explicit.

Recheck the official documentation before publishing and schedule a migration decision before that deadline. The selected public architecture remains Netlify + Go + Neon; any runtime/hosting change requires an explicit decision. The standalone Docker server remains the local development/test fallback.

Official references:

- https://docs.netlify.com/build/functions/get-started/
- https://docs.netlify.com/build/functions/lambda-compatibility/?fn-language=go
- https://docs.netlify.com/build/functions/configuration/

Local compilation and adapter tests cover the supplied build and routing code. The user's deployed function logs confirm execution but show a database initialization failure; successful live platform/database operation has not yet been verified.
