# Project context and agent handoff

Keep this file current when functionality, deployment, verified shop facts, or outstanding work changes. Read it before making changes. This is a local React/Go/PostgreSQL application, not a Floot or Sites-hosted project. The Sites skill was used only for local implementation guidance; do not register or publish a new hosted site merely because that skill is installed.

## Purpose and scope

Build a usable, reliable ordering app for one real shawarma shop. Customers select products/options, submit a guest order, track a private link, collect at the shop, and pay at pickup. Staff manage the queue, products, availability, opening hours, and preparation times.

The user wants interface quality, usability, realistic shop information, and production readiness. Continue from the implementation here; do not replace the app with a static mockup or a different hosting platform. Delivery, online payments, customer accounts, multiple shops, push/SMS, and different staff permission levels are not currently implemented.

## Confirmed shop context

User supplied on 2026-10-10:

- Name: **Я люблю шаверму**.
- Pickup address: **Белорусская ул., 4**.
- Opening hours: **09:00–22:00**, interpreted as daily because no day exceptions were supplied.
- Timezone: **Europe/Moscow** (UTC+3).
- The user-supplied Yandex Maps listing confirms Saint Petersburg and the same pickup address.
- On 2026-10-10, the user supplied Yandex Maps organization **223602659821** as the source for menu photos and prices. It is labelled **Я@Ша** on Yandex. Current kitchen settings also use **Я@Ша**, which the import preserved; the original user-provided name was **Я люблю шаверму**. Do not overwrite current staff settings from an older configuration file. The imported snapshot has 19 items, prices, portion sizes, and local photos in three categories. See `config/menu.json` and `docs/MENU_SOURCE.md`.
- Phone and complete ingredients/allergens remain unconfirmed. The listing supplies no full descriptions or paid extras; leave these fields unset instead of inventing them.

The running shop's initial three demo products were replaced with the 19-item Yandex menu. Imported products receive new IDs, so an old saved demo cart cannot silently become a different dish. Historical order snapshots remain unchanged. Demo mode is now disabled because the catalogue has been replaced with the user-selected source. Fresh databases still seed the three demo fixtures; apply the explicit catalogue import described in `docs/MENU_SOURCE.md` after setup. Photo provenance is documented in `public/images/CREDITS.md`; Yandex photos are not claimed to be CC0.

The original shop setup is retained in `config/shop.json`, including the original Я люблю шаверму name. `scripts/configure-shop.mjs` applies that setup to the running local app using credentials loaded from `.env`, preserves other settings, and logs out afterward. It only targets localhost or the Compose `web` service and supports the shared local login. Reapplying it would overwrite the current Я@Ша name; review staff edits before rerunning setup. Named staff should configure the shop through Kitchen → Settings instead.

## Architecture

- `src/main.tsx`: React 19, React Router, shared cart and menu providers.
- Routes: `/` menu, `/checkout`, `/track#PRIVATE_TOKEN`, `/kitchen`.
- `src/menu.tsx`: one shared menu polling request for layout/customer/staff pages.
- `src/cart.tsx`: persistent cart, canonical option-aware line keys, current option pricing, 20 items per variant, 50 total items, 30 distinct lines.
- `src/pages/Checkout.tsx`: frozen pending submission with persistent exact-payload retries; do not discard pending attempts after ambiguous errors such as network loss or HTTP 429.
- `src/usePolling.ts`: nonoverlapping requests, cleanup/reconnection, completion predicate for terminal customer orders.
- `backend/internal/app`: validation, API, transactional PostgreSQL store, security, integration tests.
- `backend/internal/app/schema.sql` + `migrations/*.sql`: migrations embedded in the binary, applied transactionally once under an advisory lock, recorded in `schema_migrations`.
- `backend/cmd/server`: standalone HTTP API, graceful shutdown, daily maintenance.
- `backend/cmd/migrate`: explicit migrations; `cmd/netlify`: alternate Lambda-compatible adapter; `cmd/hash-password`: bcrypt helper reading stdin.
- `compose.yaml`: persistent local database, private API, nginx web at `127.0.0.1:5173`; optional `operations` profile for daily backups.
- `compose.vite.yaml` + `Dockerfile.dev`: current local frontend mode, replacing `web` with Vite at the same URL, Windows file polling, and a separate Linux dependency volume. Read `docs/DEVELOPMENT.md` before starting/rebuilding services; omitting the override switches back to the nginx build.
- `compose.tools.yaml`: Node and Go tools when the host lacks them.
- `compose.dev.yaml`: exposes PostgreSQL locally only for host development.
- `compose.e2e.yaml`: isolated browser-test stack using a disposable tmpfs database. Use project name `shawarma-review` to keep it separate from the shop.
- `compose.e2e.vite.yaml`: optional Vite frontend for that disposable test stack, using internal WebSocket port 80.

## Implemented improvements

- Menu-first storefront with a compact shop header, food cards (two columns on phones), desktop sticky basket/mobile basket sheet, neutral white/grey surfaces, restrained red-orange actions, accessible labelled dialogs, keyboard focus restoration, and safe-area spacing.
- Locally hosted Inter Variable with Cyrillic and optical size 24, matching the font family identified in the current Wildberries/RWB careers CSS. The previous CSS named Inter but did not load it. License/provenance are in `public/fonts/`.
- Product details include image, optional extras, quantity, exact total, and expandable composition. Checkout separates pickup, guest information, and payment at collection; the submit action remains reachable on mobile.
- Product details, ingredient/allergen fields, configurable options/extras, distinct variant quantities, and server-verified pricing. Historic receipts preserve purchased names, option labels, and prices.
- Consistent paused/closed/unavailable states; reductions/removals remain possible while additions stop. Cart limits match backend validation.
- Checkout locks its submitted snapshot. After a lost response, retries/reloads reuse the same key, items, note, name, and expected prices, preventing duplicate orders.
- Private tracking, last five order links saved on this browser, late/cancelled/completed messages, cancellation reasons, configured contact/directions, Moscow dates and times, and no automatic polling once an order closes.
- Kitchen shows all active orders regardless of age plus up to 300 recently closed orders. It has mobile bottom navigation, clickable queue counters, 5/10/15/20/30-minute ETA shortcuts, custom time entry, suggested cancellation reasons with explicit confirmation, availability switches, new-order notices/sound, and shop/product/options editors. Settings time presets and weekly schedule copy affect the draft until explicitly saved.
- Configurable opening schedule including overnight shifts. A manual pause overrides schedule; enabled empty schedules close intake.
- Optional named staff users via `STAFF_USERS` bcrypt-hash JSON. Every account has the kitchen role. Password changes/removal revoke previous named sessions; menu/order/settings changes record the staff name transactionally in `audit_events`.
- Versioned migrations, health checks, slow/error API logging without bearer URLs, private API port, no nginx API URL logs, daily backup service, session/rate-counter cleanup, and opt-in closed-order retention.

## Design direction and invariants

Read `docs/DESIGN.md` before interface changes. User references: Rostic's, Yandex Go / Yandex Eats, Вкусно — и точка for ordering, and Wildberries careers for typography. Keep the app familiar to Russian food customers without copying another brand's assets. Use clear Russian labels, rubles, Moscow time, real shop content, a compact catalogue, clear prices, and accessible mobile controls. Avoid oversized marketing heroes, excessive bold text, decorative dashboard tiles, invented promotions, and unsupported delivery/payment features.

The user's explicit menu-source instruction authorizes the photos from the linked shop listing. Use the locally stored, checksum-recorded Yandex photos rather than stock photos, generated food, or hotlinks. Prices are a dated snapshot, not a live Yandex integration. Do not infer recipes, allergens, vegan certification, or extras from a photo/name. Staff retain responsibility for current availability and menu updates.

Inter must load from the local font asset; a `font-family` declaration alone is insufficient. Customer primary actions use red-orange; ordinary catalogue quantity controls are neutral. Phone food cards use two columns, customer submission stays at the bottom, and kitchen navigation has three stable bottom destinations. Reserve safe-area space so fixed controls do not cover content.

Order ETA presets persist immediately and announce the result. Settings presets and schedule copying update only the form draft. Cancellation suggestions never cancel automatically. Availability changes must wait for a successful API result before displaying the new state. Do not change checkout retry/snapshot rules during visual work.

## Security and data invariants

- Never print `.env`, passwords, session cookies, or private tracking tokens. Never commit them. Do not bake `.env*`, backups, or browser artifacts into Docker images.
- Backend computes prices from the database and validates selected options. Expected unit price includes selected extras. Do not trust client totals.
- Duplicate request keys with identical payloads return the existing order, even if intake subsequently closes or prices change. Different payloads using the same key return 409.
- Preserve price/name/option snapshots on existing orders.
- Public tracking excludes customer name/note, internal ID, and bearer token. Sequential order numbers cannot retrieve orders.
- Staff cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS. Staff writes require the exact configured Origin.
- Default Compose only publishes nginx. API `TRUST_PROXY=true` relies on nginx overwriting the client-IP header; never expose that API port directly.
- The local Vite override publishes the same localhost-only frontend port and proxies `/api` privately. Its proxy overwrites `X-Real-IP` and keeps the browser Origin intact. Vite file serving denies environment files, backups/artifacts, backend source, and private configuration directories. Do not set unrestricted allowed hosts/CORS or expose this development server publicly.
- Expired sessions/counters are cleaned automatically. Order deletion is disabled by default (`ORDER_RETENTION_DAYS=0`); do not enable it without an explicit retention choice. Active orders must never be deleted by maintenance.
- Avoid testing mutations against the shop database. Integration tests use isolated schemas; browser tests use their own database.

## Working and verification commands

Host Node/npm are absent in the current Windows environment; Docker Desktop and Go are available. Docker CLI may need sandbox escalation. Source directory contains spaces, so quote paths. The folder currently has no `.git` repository; don't assume `git status` works.

Local app:

For Russian source/docs in Windows PowerShell, use `Get-Content -Encoding UTF8`; the shell's default decoding can display correct UTF-8 files as mojibake. Do not rewrite those files based only on that display.

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations up -d --build
docker compose -f compose.yaml -f compose.vite.yaml --profile operations ps
```

This is the currently selected Vite hot-reload mode. Frontend source/styles changes apply on save; Go changes still require rebuilding `api`. To intentionally restore the production nginx frontend, run `docker compose --profile operations up -d --build --no-deps web` and refresh the browser. Both modes use the same database; never reset the shop volume as part of switching modes. Dependency changes require synchronizing the separate development node_modules volume; see `docs/DEVELOPMENT.md`.

Frontend and backend checks:

```powershell
docker compose -f compose.yaml -f compose.tools.yaml run --rm frontend-tools npm ci
docker compose -f compose.yaml -f compose.tools.yaml run --rm frontend-tools npm run check
docker compose -f compose.yaml -f compose.tools.yaml run --rm backend-tools go test -v ./...
docker compose -f compose.yaml -f compose.tools.yaml run --rm backend-tools go vet ./...
```

Browser checks:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml up -d --build db api web
docker compose -p shawarma-review -f compose.e2e.yaml run --build --rm browser
docker compose -p shawarma-review -f compose.e2e.yaml down
```

Screenshots go to `artifacts/` (ignored). `Dockerfile.browser` includes Chromium and fonts; override its command with `sh -c 'npm run check && npm run test:e2e'` to run unit/build/browser checks in one Linux container. `scripts/capture-preview.mjs` performs a read-only local storefront capture; see `docs/TEST_RESULTS.md` for its Docker command. Read that document for the exact checks completed on the final revision, rather than assuming old results still apply.

Browser tests must start with a fresh disposable stack for repeated full-suite runs. Staff login limits are persistent (10 attempts per IP per 10 minutes); previous runs can exhaust them. Stop `shawarma-review` with its explicit Compose project/file, then rerun the suite to recreate its tmpfs database. Never weaken production rate limits or reset the actual shop database to make UI tests pass. Browser HTML reports/traces are kept under `artifacts/` for diagnosis.

## Current local state (2026-10-10)

The updated shop is running in **Vite development mode** at `http://localhost:5173` with the confirmed name/address and all seven 09:00–22:00 shifts applied. The existing API/database and daily backup service remain in use. The 19-item Yandex catalogue and all locally hosted menu photos are applied; demo mode is disabled. Backups were taken before and after the catalogue import, and the existing order's snapshot was preserved. Catalogue reapplication was checked in the disposable database: no duplicates or ID changes, and stock/composition edits remain intact. The disposable browser stack is stopped after verification; normal app services remain running.

Verification: the design pass passed 11 frontend tests, 9 browser scenarios, production builds, and responsive checks for storefront/checkout/kitchen at four widths. The earlier pass on the same day also passed PostgreSQL-backed Go tests/race detector, static analysis, and backup restoration; the redesign does not change backend contracts. Tests used isolated schemas/databases. Review `docs/TEST_RESULTS.md` for scope and limitations before claiming production readiness.

The subsequent catalogue pass rechecked 11 frontend tests in the Linux browser image, the current web production build, all 19 served photo checksums/catalogue prices, search, four responsive widths, and a temporary 710 ₽ guest basket/checkout without submitting an order. Both existing order item/total snapshots were preserved (2 → 2). The expanded catalogue has images below the viewport; screenshot scripts must request lazy images before awaiting all their decodes. Windows bind-mounted Vitest workers timed out in this pass; use the Linux browser image if that recurs instead of loosening test timeouts.

The Vite setup was verified against the running shop with a temporary CSS property: it applied and was removed without navigation, the WebSocket connected, the API/menu remained available, and private environment/backup files returned 403. The final configuration passed 11 frontend tests/build and all 9 existing browser scenarios through Vite in the disposable database. See `docs/TEST_RESULTS.md`. Refresh an existing production-build browser tab once to load the Vite client; subsequent frontend edits update automatically.

## Remaining launch work

1. Confirm current menu availability, complete ingredients/allergens, phone, and any weekly exceptions to 09:00–22:00. Prices/photos/portion sizes were imported from the user-selected Yandex listing on 2026-10-10; update future changes through Kitchen → Menu. Demo mode is already disabled in the running shop.
2. Choose public hosting/domain, HTTPS termination, and production database. No cloud deployment is authorized or configured by the current task.
3. Configure named staff identities/passwords for actual staff. Shared login remains available for the local demo; role separation is a future feature.
4. Choose an encrypted off-machine backup destination and an external uptime alert destination. Local backup health and service health checks exist; they are not remote alerts.
5. Choose retention/archival policies if required. Closed-order deletion stays off; audit events remain retained.
6. Initialize version control and connect CI when the user chooses a repository. Existing GitHub Actions configuration has not run on GitHub.
7. The Netlify adapter is retained, but recheck provider support before deploying it. Standalone Docker/Go is the verified local path.

## Detailed references

- `README.md`: setup, features, development, scope.
- `docs/OPERATIONS.md`: staff credentials, backups/restore, monitoring, retention, deployment constraints.
- `docs/DEVELOPMENT.md`: current Docker/Vite hot reload, startup/mode switching, dependency volume, and isolated verification.
- `docs/API.md`: endpoint/payload contracts.
- `docs/DESIGN.md`: interface principles, typography provenance, responsive behaviour, interaction rules, and design verification.
- `docs/MENU_SOURCE.md`: the dated Yandex catalogue, photo provenance, explicit transactional import, and preserved data invariants.
- `docs/TEST_RESULTS.md`: current verification evidence and limits.
- `docs/DEPLOYMENT.md`: existing Netlify deployment guide; provider lifecycle notes must be rechecked before relying on them.
