# Testing and verification

This file is the reproducible testing guide. Its existing filename is kept so older links continue to work. It is not a cumulative diary or a claim that a particular current checkout is fully verified.

Run checks against the revision you intend to release. Record results locally with the commit/revision, commands, skipped tests, environment and remaining limits. Do not infer today's coverage from historical pass counts.

## Isolation rules

- Never set `TEST_DATABASE_URL` or browser test targets to the shop/production database.
- Backend integration tests create/drop isolated schemas, but still require a **dedicated test database** and permissions to create schemas.
- Browser tests intentionally mutate data. Use `compose.e2e.yaml` with project name `shawarma-review`.
- Its PostgreSQL data is tmpfs and disappears when the database container stops.
- Use synthetic accounts/operator details/orders only. Keep screenshots, traces and authentication state under ignored `artifacts/`.

## Frontend: unit tests and production build

Docker-only path, from the root:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml build browser
docker compose -p shawarma-review -f compose.e2e.yaml run --rm --no-deps browser npm run check
```

The image installs dependencies and copies source into Linux, avoiding slow Windows-mounted test workers. Rebuild it after source changes.

With host Node.js 22.12+:

```powershell
npm ci
npm run check
```

`check` runs Vitest, then TypeScript checking and a Vite production build. It does not run Go or Playwright.

Current test areas include basket validation/store isolation, saved-order history and metadata recovery, request polling, route/root recovery, reporting series and kitchen sound. Customer sound/vibration was removed and is not a supported feature.

## Backend: PostgreSQL integration and static analysis

Host path, from `backend/`, with an explicitly exported dedicated `TEST_DATABASE_URL`:

```text
go test -v ./...
go vet ./...
```

Without that variable, database integration tests **skip**; a successful exit does not establish database coverage.

Docker-only example, from the root:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml up -d db
docker run --rm --network shawarma-review_default -v "${PWD}:/app" -w /app/backend -e TEST_DATABASE_URL=postgres://shawarma:e2e-only-password@db:5432/shawarma_test?sslmode=disable golang:1.25.5-alpine sh -c 'apk add --no-cache postgresql17-client && go test -v ./... && go vet ./...'
```

This installs PostgreSQL client tools inside the disposable tools container so dump/restore tests can run. The mount contains project source; the test connection targets only the disposable database.

For race detection, use `go test -race -v ./...` in a Go environment with CGO and a supported C toolchain. The supplied GitHub backend job provides that environment; a minimal Alpine container may need additional compiler packages.

Check the output for skips, especially `TestPrivacyBackupRestore`. That test needs PostgreSQL dump/restore tools as well as a dedicated database. Testing migration/restore code does not migrate the shop.

Stop the disposable database when finished, unless continuing with browser tests:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml down
```

## Browser regressions

Start from a fresh test stack. If this project already ran, stop only that stack before recreating it:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml down
docker compose -p shawarma-review -f compose.e2e.yaml up -d --build db api web
'e2e-only-kitchen-password' | docker compose -p shawarma-review -f compose.e2e.yaml exec -T api staff-admin -mode bootstrap -username owner -name TestOwner
docker compose -p shawarma-review -f compose.e2e.yaml run --build --rm --no-deps browser
docker compose -p shawarma-review -f compose.e2e.yaml down
```

The displayed password is a deliberate disposable fixture, not a production credential. Global test setup logs into this owner and configures synthetic privacy documents in the test database.

For Vite-specific/HMR testing, include `-f compose.e2e.vite.yaml` after `-f compose.e2e.yaml` in all relevant commands. That stack uses the test API/database, not the normal shop.

A focused run can replace the default browser command:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml run --rm --no-deps browser npx playwright test tests/e2e/order.spec.ts
```

Rebuild the browser image first if source/tests changed. Repeated runs against the same database can exhaust persistent login limits; recreate the **test** database rather than changing application limits.

### What to cover

| Area | Checks |
| --- | --- |
| Checkout | Server pricing/options, optional-data consent, unavailable items, pauses, store mismatch, ambiguous response retries |
| Tracking/history | Automatic updates, no private fields, token-only lookup, expired receipts, route switching, saved links and legacy repair |
| Staff | Owner/manager/worker boundaries, mixed store roles, temporary passwords, resets, revocation and last-owner protection |
| Shared kitchens | Pending/approved/revoked devices, concurrent shared logins, fixed 30-day deadline, store switching, alert-only credentials and offline coverage without intake suspension |
| Toppings | Dish/standalone price and portion snapshots, quantity multiplication, shared availability, full-product injection protection and independent retry-safe menu copies |
| Owner | Navigation/refresh/Back, shared store filters, full membership edits, menu-copy retry and active-order archival rejection |
| Privacy | Unconfigured intake, immutable versions, accepted retries after policy changes, requests/verification/export/erasure |
| Retention | Seven-day/year boundaries, active exemptions, aggregates, repeated/concurrent jobs and restore-journal replay |
| Reliability | Obsolete request cancellation, failed refreshes, unsaved drafts, reauthentication without duplicate actions |
| Interface | 320, 390, 768 and 1440px, keyboard navigation, dialogs/focus, readable charts and no horizontal overflow |

Not every row is covered by every test file. Read the actual assertions and verify remaining release requirements separately.

## Interpreting failures

The final `FAIL` line is not the cause. Find the first `--- FAIL:` block for Go, the failing assertion for Vitest, or the first failed Playwright test and trace.

- A database test skip usually means missing `TEST_DATABASE_URL` or client tools.
- A browser fixture-login failure can mean missing owner bootstrap, wrong origin or a reused rate-limited test database.
- A 404 for a new API route can mean the browser is testing an old API image.
- A 500 with healthy PostgreSQL can indicate missing migrations.
- Preserve a failure's report before recreating its test database if you need diagnosis.

Compose browser reports, screenshots and traces are mounted into `artifacts/`. Host CI may write `playwright-report/` instead; both are ignored.

## Continuous integration and deployment are separate

`.github/workflows/checks.yml` runs frontend tests/build, PostgreSQL-backed Go tests with the race detector and vet, compilation of the server/function, and Playwright.

The Netlify build command compiles the frontend/function; it does not run the whole suite. This repository does not itself make Netlify wait for successful GitHub checks. Provider/branch settings must enforce any desired release gate.

## Limits of these checks

Passing tests do not establish real-device Safari behaviour, phone background delivery, load capacity, uptime, legal compliance or production database configuration. Browser automation primarily uses Chromium.

Android compilation, JVM alert-schedule tests and lint are separate from browser checks; run the [APK build helper](../android-kitchen/README.md#build-and-sign). Locked-screen delivery, Teclast power management/audio routing and an operating-day soak require the actual tablet. Desktop tests do not replace that acceptance.

A documentation-only update should validate links, commands and references without presenting that as a new application regression run. Do not put private tokens, personal records or operator drafts into verification artifacts.
