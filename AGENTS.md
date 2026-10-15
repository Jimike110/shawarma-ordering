# Project context and agent handoff

Keep this file current when functionality, deployment, verified shop facts, or outstanding work changes. Read it before making changes. This is a local React/Go/PostgreSQL application, not a Floot or Sites-hosted project. The Sites skill was used only for local implementation guidance; do not register or publish a new hosted site merely because that skill is installed.

## Purpose and scope

Build a usable, reliable ordering app for one real shawarma shop. Customers select products/options, submit a guest order, track a private link, collect at the shop, and pay at pickup. Staff manage the queue, products, availability, opening hours, and preparation times.

The user wants interface quality, usability, realistic shop information, and production readiness. Continue from the implementation here; do not replace the app with a static mockup or a different hosting platform. Multiple stores within one business and owner/manager/worker permissions are now implemented. Separate businesses still use separate deployments/databases. Delivery, online payments, customer accounts, push/SMS, two-factor authentication and email invitations remain outside scope.

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

The original shop setup is retained in `config/shop.json`, including the original Я люблю шаверму name. `scripts/configure-shop.mjs` now requires explicit `STORE_ID`, `STAFF_USERNAME` and `STAFF_PASSWORD`, uses the database-backed staff login, preserves other settings, and logs out afterward. It only targets localhost or the Compose `web` service. Reapplying it would overwrite the current Я@Ша name; review staff edits before rerunning setup. Managers/owners should configure the shop through Kitchen → Settings instead. Catalogue/transfer SQL preparation also requires an explicit `STORE_ID`.


`scripts/prepare-shop-transfer.mjs` exports the current local public catalogue/settings, checks photo checksums, and prepares ignored `artifacts/shop-transfer.json` / `artifacts/import-shop.sql` without connecting to a target database. The pure SQL file can be run in Neon's SQL Editor after migrations. It is atomic, preserves orders and unrelated products, matches by image, removes only untouched demo fixtures, and refuses conflicting target staff edits. Reapplying an identical snapshot retains product IDs. This is a one-time initial-data transfer, not continuous sync. A prepared artifact passed isolated PostgreSQL rollback/repeat/conflict/order-preservation checks; **no Neon transfer was executed**. See `docs/DEPLOYMENT.md` for the exact steps.

## Architecture

- `src/main.tsx`: React 19, React Router, shared cart and menu providers.
- Staff/owner context identities live in dependency-only `src/auth.ts`, `src/staffStore.ts` and `src/ownerContext.ts`. Import hooks from those modules, never from screen/provider component files. A former `staff → Kitchen/Reports → staff` cycle reproduced “Missing staff authentication” when Vite refreshed Kitchen while Owner was open. Keep this graph acyclic; HMR regression tests edit only a disposable source copy. `src/ErrorBoundary.tsx` supplies independent Russian route/root recovery screens without exposing raw errors, clearing browser storage or resubmitting checkout.
- Routes: `/` opens the last selected published store (otherwise the first); customers choose the pickup address using the header dropdown. `/s/:slug` menu and `/s/:slug/checkout`, `/orders` browser order history, `/track#PRIVATE_TOKEN`, `/kitchen` staff entry, `/staff/stores/:storeId` scoped kitchen, `/owner` business dashboard. Store baskets and pending submissions stay independent when switching. Legacy `/checkout` and public API requests stay anchored to original store 1; `/#orders` redirects to `/orders`.
- `src/menu.tsx`: one shared menu polling request for layout/customer/staff pages.
- `src/cart.tsx`: persistent cart, canonical option-aware line keys, current option pricing, 20 items per variant, 50 total items, 30 distinct lines.
- `src/pages/Checkout.tsx`: frozen pending submission with persistent exact-payload retries; do not discard pending attempts after ambiguous errors such as network loss or HTTP 429.
- `src/pages/Orders.tsx`, `src/orderHistory.ts`, `src/useSavedOrders.ts`: dedicated browser history, legacy metadata recovery, and change subscriptions. The catalogue subscribes for its count with recovery disabled; history repair runs on `/orders`.
- `app.Open` requires a nonblank explicit `DATABASE_URL` and refuses PostgreSQL driver's localhost/OS-user defaults. Direct `go run ./cmd/migrate` does not load `.env`; export the Neon direct URL in the same terminal. The user also uses Git Bash/MINGW64, so provide Bash commands there rather than PowerShell `$env:` assignments; secure prompt examples are in `docs/DEPLOYMENT.md`.
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

## Selected deployment direction (2026-10-10)

### Privacy preparation (2026-10-15)

`004_privacy.sql` and `/owner/privacy` add operator drafts, immutable published policy/consent versions, separate optional-field consent and verified owner rights actions. Migration leaves operator details blank, labels historical consent unknown and blocks **new** ordering until publication; it does not activate cleanup. Existing fulfilment/tracking and exact accepted retries remain available. Checkout freezes document versions too. Never retrofit consent onto legacy orders or change accepted retry fingerprints.

Read `PRIVACY_OPERATIONS.md` before upgrading, activating retention or restoring data. The explicit `privacy-maintenance` CLI defaults to preview; reviewed activation is separate. Seven-day optional-field/audit-copy erasure and one-year receipt expiry preserve aggregate analytics using sums/sample counts. Expired keys cannot recreate receipts. Privacy mutations require a durable separate journal (`PRIVACY_JOURNAL_PATH`) and the existing stable `SESSION_SECRET`; replay/drain must precede reopening a restore. `compose.privacy.yaml` is an opt-in journal/CLI configuration, not an installed production scheduler. The old nonzero `ORDER_RETENTION_DAYS` deletion path is retired. Production scheduling, encrypted independent journal replication and backup expiry remain operator deployment tasks.

**Russian production infrastructure is now an explicit launch prerequisite.** The existing Netlify/Neon arrangement remains demonstration infrastructure; code/document publication does not resolve foreign database localization, provider logs/backups, operator legal approval or RKN duties. No production migration or deployment was performed. Keep operator-specific drafts and routine test artifacts local. Statutory destruction acts require responsible persons' completion/signatures in addition to the owner-downloadable log extract.

The local development API was rebuilt on 2026-10-15 after a verified backup (`backups/pre-privacy-upgrade-20261015-095517.dump`) to resolve new privacy pages calling an outdated Go binary. Migration 004 is applied locally; all 5 orders, 38 products and 2 settings records were preserved. Operator documents remain unpublished and retention cleanup disabled, so new ordering is blocked until publication. Vite reloads frontend changes automatically; Go changes require rebuilding `api`. Netlify/Neon were untouched.

The user selected **one separate GitHub repository, one Netlify site (React build + Go functions), and one Neon project per business**, owned by the user's accounts. Local editing and Docker/Vite remain the development workflow. Keep each business's data, credentials, origins, and deployment configuration separate. Do not substitute the previously suggested VPS path or another hosting platform without a new user instruction.

`docs/DEPLOYMENT.md` records the setup and provider constraints. Runtime uses Neon's TLS pooled URL; explicit migrations/backup/restore use its direct URL. Production secrets must not be shared with deploy previews; previews need an isolated empty/sanitized database or stay disabled. The hosted app is `https://shawarma-ordering.netlify.app`. Read-only checks on 2026-10-16 returned 200 for `/api/health` but 500 for `/api/stores` and `/api/privacy`; both data endpoints return 200 locally. The user confirmed the latest production migrations have not been run. A deployed-code/database-schema mismatch is the likely cause; the Netlify adapter deliberately does not apply migrations. Back up and explicitly migrate the intended hosted database before verifying its data endpoints and operator setup. No hosted migration or repair was performed by the agent. GitHub checks and Netlify builds currently run independently; the Netlify build compiles without running the tests, and repository configuration does not gate production publication on successful GitHub checks. Do not imply that pushing to rerun CI is deployment-free when auto publishing is enabled. Local `.env` does not supply function runtime secrets. Hosted migration/menu/release verification remains outstanding. Official Netlify docs checked on 2026-10-10 stop accepting Lambda-compatibility deployments from **2027-07-01**; a long-term migration decision remains open. Do not claim the modern TypeScript wrapper automatically supports this Go binary. The agent did not provision public resources.

## Implemented improvements

- Owner workspace: `/owner`, `/owner/stores`, `/owner/staff`, `/owner/analytics` and `/owner/privacy` share a desktop sidebar/mobile bottom navigation and URL-backed store context. Overview prioritizes intake blockers and live queues; Analytics separates metrics/history/activity; privacy separates documents/requests/retention. Store and staff lists have search/filter controls; account editing preserves all assignments. `src/ownerWorkspace.tsx` owns store polling/context and unsaved-navigation protection; the app uses React Router's data router for that guard. Backend store responses include independent `intake_blockers`; owner history/activity accept server-side `store_id` filters without weakening staff scope. The local API was updated after backup for this redesign; Vite remains active, with no schema migration or production deployment. Orders, catalogue, settings and operator configuration were preserved. Future backend changes still require rebuilding `api` alongside the frontend.

- Menu-first storefront with a compact shop header, food cards (two columns on phones), desktop sticky basket/mobile basket sheet, neutral white/grey surfaces, restrained red-orange actions, accessible labelled dialogs, keyboard focus restoration, and safe-area spacing.
- Locally hosted Inter Variable with Cyrillic and optical size 24, matching the font family identified in the current Wildberries/RWB careers CSS. The previous CSS named Inter but did not load it. License/provenance are in `public/fonts/`.
- Product details include image, optional extras, quantity, exact total, and expandable composition. Checkout separates pickup, guest information, and payment at collection; the submit action remains reachable on mobile.
- Product details, ingredient/allergen fields, configurable options/extras, distinct variant quantities, and server-verified pricing. Historic receipts preserve purchased names, option labels, and prices.
- Owners and assigned managers can permanently remove products through Kitchen → Menu with explicit confirmation; workers only control availability. Store-scoped and legacy DELETE routes enforce the same management permissions. Deletion is audited transactionally and serialized with checkout; existing order snapshots, private receipts and accepted retries survive removal.
- Consistent paused/closed/unavailable states; reductions/removals remain possible while additions stop. Cart limits match backend validation.
- Checkout locks its submitted snapshot. After a lost response, retries/reloads reuse the same key, items, note, name, and expected prices, preventing duplicate orders.
- Private tracking and all locally saved order links on the separate `/orders` “Мои заказы” page, newest first with numbers and Moscow dates/times. The home screen only shows a shortcut/count, including an accessible empty history; never render the full history in the catalogue. Legacy token-only entries recover metadata on the history page; the home count uses `useSavedOrders({ recoverMetadata: false })`. Successful tracking visits save their link/metadata without reordering older orders ahead of newer ones, and offer “Все мои заказы”. History reacts to other-tab storage changes and keeps unavailable links. Late/cancelled/completed messages, cancellation reasons, configured contact/directions, and no automatic tracking polling once an order closes.
- Kitchen shows all active orders regardless of age plus up to 300 recently closed orders. It has mobile bottom navigation, clickable queue counters, 5/10/15/20/30-minute ETA shortcuts, custom time entry, suggested cancellation reasons with explicit confirmation, availability switches, new-order notices/sound, and shop/product/options editors. Settings time presets and weekly schedule copy affect the draft until explicitly saved.
- Configurable opening schedule including overnight shifts. A manual pause overrides schedule; enabled empty schedules close intake.
- Database-backed individual staff accounts with owner access to all stores and manager/worker memberships per store. Workers fulfil orders and manage availability/preparation/operational pause; managers additionally edit menu/settings and see their store reports. Owners manage accounts, store lifecycle and owner stops. New menus are independent; copying adds unavailable products. Historical timings are not fabricated, and completed-order value is not verified cash revenue.
- Versioned migrations, health checks, slow/error API logging without bearer URLs, private API port, no nginx API URL logs, daily backup service, session/rate-counter cleanup, and opt-in closed-order retention.

## Design direction and invariants

Read `docs/DESIGN.md` before interface changes. User references: Rostic's, Yandex Go / Yandex Eats, Вкусно — и точка for ordering, and Wildberries careers for typography. Keep the app familiar to Russian food customers without copying another brand's assets. Use clear Russian labels, rubles, Moscow time, real shop content, a compact catalogue, clear prices, and accessible mobile controls. Avoid oversized marketing heroes, excessive bold text, decorative dashboard tiles, invented promotions, and unsupported delivery/payment features.

The user's explicit menu-source instruction authorizes the photos from the linked shop listing. Use the locally stored, checksum-recorded Yandex photos rather than stock photos, generated food, or hotlinks. Prices are a dated snapshot, not a live Yandex integration. Do not infer recipes, allergens, vegan certification, or extras from a photo/name. Staff retain responsibility for current availability and menu updates.

Inter must load from the local font asset; a `font-family` declaration alone is insufficient. Customer primary actions use red-orange; ordinary catalogue quantity controls are neutral. Phone food cards use two columns, customer submission stays at the bottom, and kitchen navigation has three stable bottom destinations. Reserve safe-area space so fixed controls do not cover content.

Order ETA presets persist immediately and announce the result. Settings presets and schedule copying update only the form draft. Cancellation suggestions never cancel automatically. Availability changes must wait for a successful API result before displaying the new state. Do not change checkout retry/snapshot rules during visual work.

Kitchen sound starts enabled on each visit. `src/useKitchenSound.ts` preloads/decodes the locally hosted user-selected `public/audio/new-order-313025.mp3` (Akshai kanth / Pixabay; attribution and checksum in `public/audio/CREDITS.md`), resumes browser audio automatically where allowed and on a normal click/key press otherwise, retaining an alert received before activation or loading. It plays the complete recording; muting stops playback and lasts only for the current page visit. The UI distinguishes blocked/loading audio from working sound. Audio needs the kitchen page open and remains subject to browser/device restrictions.

## Security and data invariants

- Never print `.env`, passwords, session cookies, or private tracking tokens. Never commit them. Do not bake `.env*`, backups, or browser artifacts into Docker images.
- Backend computes prices from the database and validates selected options. Expected unit price includes selected extras. Do not trust client totals.
- Duplicate request keys with identical payloads return the existing order, even if intake subsequently closes or prices change. Different payloads using the same key return 409.
- Preserve price/name/option snapshots on existing orders.
- Public tracking excludes customer name/note, internal ID, and bearer token. Sequential order numbers cannot retrieve orders.
- Browser order history uses private tokens, never numeric lookup. Retain all valid saved links; do not reintroduce a five-order cap or discard entries on request/storage failures. Consume the legacy `shawarma-last-order` key only after the complete `shawarma-orders` history is saved. Repair missing metadata through the private endpoint, abort on navigation, and do not attach stale tracking data to a different token. Clearing browser storage or the old five-link truncation cannot be reversed without the original personal link; there is no customer account/device sync.
- Staff cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS. Staff writes require the exact configured Origin.
- Migration `003_access.sql` revokes legacy staff sessions. Environment kitchen passwords no longer authenticate; `STAFF_USERS` is accepted only by an explicit administrative import command. New passwords use Argon2id; owner-issued temporary passwords expire in 24 hours and require replacement. Database sessions last 12 hours and use `staff_session` scoped to `/api`; password/access changes revoke sessions immediately. Sensitive owner actions require recent password confirmation. Bootstrap/recovery use `scripts/staff-admin.ps1`, defaulting to owner / Владелец with hidden terminal input. Back up before migration and never run test fixtures against shop data; see the essential README upgrade instructions.
- The user now reports successful kitchen login followed by logout on refresh on the deployed site, suggesting the earlier missing-database configuration was addressed. The confirmed local cross-instance shared-password defect explains this behavior when `KITCHEN_PASSWORD` is used; deployment of the correction and live hosted checks remain outstanding. Do not continue presenting the earlier `/tmp` connection failure as a newly verified current outage.
- Default Compose only publishes nginx. API `TRUST_PROXY=true` relies on nginx overwriting the client-IP header; never expose that API port directly.
- The local Vite override publishes the same localhost-only frontend port and proxies `/api` privately. Its proxy overwrites `X-Real-IP` and keeps the browser Origin intact. Vite file serving denies environment files, backups/artifacts, backend source, and private configuration directories. Do not set unrestricted allowed hosts/CORS or expose this development server publicly.
- Standalone sessions/counters are cleaned hourly. Privacy erasure/receipt archival stays disabled until reviewed owner activation and runs through the separate CLI. Keep legacy `ORDER_RETENTION_DAYS=0`; nonzero deletion is retired. Active orders must never be deleted by maintenance. A restored pre-closure snapshot can still be erased by an authenticated later expiry intention while offline.
- Avoid testing mutations against the shop database. Integration tests use isolated schemas; browser tests use their own database.
- Privacy maintenance first takes singleton advisory lock 184021, then waits for exclusive replay lock 184020 with context cancellation. Checkout/status updates share 184020; their presence must not be mistaken for another maintenance worker. Browser tests that answer unsaved-change dialogs must await dialog handling as well as the click before attaching the next handler.

## Working and verification commands

Host Node/npm are absent in the current Windows environment; Docker Desktop and Go are available. Docker CLI may need sandbox escalation. Source directory contains spaces, so quote paths. The user initialized a Git repository; `main` was confirmed on 2026-10-10. Preserve user edits and check the current working tree before changing files. The user also runs Go commands in Git Bash/MINGW64.

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
'e2e-only-kitchen-password' | docker compose -p shawarma-review -f compose.e2e.yaml exec -T api staff-admin -mode bootstrap -username owner -name TestOwner
docker compose -p shawarma-review -f compose.e2e.yaml run --build --rm --no-deps browser
docker compose -p shawarma-review -f compose.e2e.yaml down
```

Screenshots go to `artifacts/` (ignored). `Dockerfile.browser` includes Chromium and fonts; override its command with `sh -c 'npm run check && npm run test:e2e'` to run unit/build/browser checks in one Linux container. `scripts/capture-preview.mjs` performs a read-only local storefront capture; see `docs/TEST_RESULTS.md` for its Docker command. Read that document for the exact checks completed on the final revision, rather than assuming old results still apply.

Browser tests must start with a fresh disposable stack for repeated full-suite runs. Staff login limits are persistent (10 attempts per IP per 10 minutes); previous runs can exhaust them. Stop `shawarma-review` with its explicit Compose project/file, then rerun the suite to recreate its tmpfs database. Never weaken production rate limits or reset the actual shop database to make UI tests pass. Browser HTML reports/traces are kept under `artifacts/` for diagnosis.

The updated shop is running in **Vite development mode** at `http://localhost:5173` with the confirmed name/address and all seven 09:00–22:00 shifts applied. The existing API/database and daily backup service remain in use. The 19-item Yandex catalogue and all locally hosted menu photos are applied; demo mode is disabled. Backups were taken before and after the catalogue import, and the existing order's snapshot was preserved. Catalogue reapplication was checked in the disposable database: no duplicates or ID changes, and stock/composition edits remain intact. The disposable browser stack is stopped after verification; normal app services remain running.

Verification: the design pass passed 11 frontend tests, 9 browser scenarios, production builds, and responsive checks for storefront/checkout/kitchen at four widths. The earlier pass on the same day also passed PostgreSQL-backed Go tests/race detector, static analysis, and backup restoration; the redesign does not change backend contracts. Tests used isolated schemas/databases. Review `docs/TEST_RESULTS.md` for scope and limitations before claiming production readiness.

The subsequent catalogue pass rechecked 11 frontend tests in the Linux browser image, the current web production build, all 19 served photo checksums/catalogue prices, search, four responsive widths, and a temporary 710 ₽ guest basket/checkout without submitting an order. Both existing order item/total snapshots were preserved (2 → 2). The expanded catalogue has images below the viewport; screenshot scripts must request lazy images before awaiting all their decodes. Windows bind-mounted Vitest workers timed out in this pass; use the Linux browser image if that recurs instead of loosening test timeouts.

The Vite setup was verified against the running shop with a temporary CSS property: it applied and was removed without navigation, the WebSocket connected, the API/menu remained available, and private environment/backup files returned 403. The final configuration passed 11 frontend tests/build and all 9 existing browser scenarios through Vite in the disposable database. See `docs/TEST_RESULTS.md`. Refresh an existing production-build browser tab once to load the Vite client; subsequent frontend edits update automatically.

The order-history fix passed **21 frontend tests** and the TypeScript/production build. All 9 existing browser scenarios passed in the disposable Vite stack; all 3 new history scenarios passed after correcting a test assumption about StrictMode's repeated initial request. Synthetic links/mock receipts verify №101 recovery, eight retained orders, persistence/order sorting, link registration/switching, and unavailable-link preservation at four widths. No real shop orders were created. See `docs/TEST_RESULTS.md` for the full-run/focused-rerun distinction.

The subsequent separate-history-page pass passed **22 frontend tests**, TypeScript/production build, and all **14 browser scenarios in one run**, with no retries, in the disposable Vite stack. `/orders` was checked at four widths with phone/desktop screenshot inspection, empty/direct/legacy-anchor navigation, and an 80-order history that adds only a count on the home screen. The live Vite `/orders` URL and API health responded successfully. No real shop orders were created; verification details are in `docs/TEST_RESULTS.md`.

## Remaining launch work

Latest backend check (owner redesign): the full Go suite with isolated PostgreSQL and `go vet ./...` pass, including the previously mismatched optional-name cases and new intake/filter isolation checks. The backup/restore rehearsal was skipped because the helper lacked PostgreSQL client tools; this run did not repeat the race detector. No tests target shop/Neon data.

1. Confirm current menu availability, complete ingredients/allergens, phone, and any weekly exceptions to 09:00–22:00. Prices/photos/portion sizes were imported from the user-selected Yandex listing on 2026-10-10; update future changes through Kitchen → Menu. Demo mode is already disabled in the running shop.
2. Complete the user-selected separate GitHub repo + Netlify site + Neon project setup for this business. The user has deployed `https://shawarma-ordering.netlify.app`, but function logs show missing effective Neon configuration; correct runtime `DATABASE_URL` and redeploy before checking hosted migrations/menu. Verify the final origin and production secrets. Resolve the Go adapter's 2027-07-01 Netlify lifecycle constraint.
3. Bootstrap the first owner explicitly, then configure actual manager/worker accounts and store assignments. Shared login is removed. Apply the new migration and bootstrap to Neon before publishing this frontend/backend together; hosted access/cookie/isolation verification remains outstanding.
4. Choose an encrypted off-machine backup destination and an external uptime alert destination. Local backup health and service health checks exist; they are not remote alerts.
5. Choose retention/archival policies if required. Closed-order deletion stays off; audit events remain retained.
6. Verify/connect the chosen GitHub remote and CI. Local Git is initialized on `main`; remote configuration and actual GitHub Actions execution have not been checked.
7. Verify Go function packaging/routing/cookies against Netlify and Neon, explicitly migrate/import real menu/settings, arrange hosted maintenance/backups, and run launch checks. Standalone Docker/Go remains the verified local development/test path; the selected public deployment is Netlify + Neon.

## Detailed references

Pitch files stay local by user instruction (2026-10-13). `.gitignore` excludes `scripts/pitch/`, root `Dockerfile.pitch*` and `compose.pitch*.yaml`; existing `artifacts/` and `docs/` rules cover generated videos/assets and pitch documentation. No pitch files were tracked when this was checked. Preserve these exclusions and the local files; do not add the pitch tooling or media to Git.

Sales focus (2026-10-11): the user is keeping the single-shop MVP and wants the first paying business. A sourced Excel outreach tracker contains 25 Saint Petersburg prospects, including 10 nearby priority-A points, at `artifacts/outreach/outputs/spb-sales-20261011/shawarma-sales-tracker.xlsx`. All initially remain **Not contacted**; no agent outreach occurred. Published business numbers are not verified owner contacts. Source caveats, current stages, follow-ups, demos, pilot dates, actual payments and Russian pitch templates are included. The 30-day free pilot / 3,000 ₽ monthly offer is a proposal, not agreed terms. Preserve subsequent workbook edits; never regenerate it with `--replace` after outreach begins. Artifacts are ignored by Git, so copy/back up the edited workbook for agent handoff. See `docs/OUTREACH.md`.

The user requested a one-minute owner pitch video and chose **portrait 9:16**. The first SVG/Microsoft Irina draft was rejected for poor graphics and robotic speech. On 2026-10-11 the user selected **cinematic realistic still images with subtle camera movement**, with a new Russian neural voice. V2 sources are `scripts/pitch/story-v2.json`, `render-v2.mjs`, `image-prompts-v2.json`, and speech scripts; ignored assets/output are under `artifacts/pitch-v2/`. The completed `shawarma-pitch-v2-ru-portrait.mp4` uses four generated cinematic images, actual app screens, and new Qwen3-TTS narration. Verified: exactly 60 seconds, 1080×1920, 24 fps/1,440 decoded frames, H.264/AAC, 11,008,003 bytes, and successful full media decode. Eight scene previews, three later UI states, and three frames extracted from the encoded MP4 were inspected. Voice timing preserves the original pace; sentence captions are approximate. Human listening/style acceptance remains the user's review step; do not present this second draft as already approved. Real app screens come only from `shawarma-review` with a disposable database. No production orders or private tracking tokens belong in pitch artifacts; cooking time is shortened and labelled.

The attempted CUDA speech Docker build exhausted C: and Docker became unresponsive. The user explicitly authorized restarting Docker, deleting the failed speech build, storing the speech model on **E:**, resetting all WSL, and moving Docker storage to E:. Recovery is complete: the original Docker data disk is `E:\DockerDesktop\wsl\disk\docker_data.vhdx`, with SHA-256-verified transfer and settings backup/receipt under `E:\DockerDesktop`. The WSL setting is **CustomWslDistroDir=E:\DockerDesktop\wsl**; `DataFolder`/`WslDataFolder` are not the correct keys for this Docker version. The temporary empty C: disk was removed after the original 14 containers/13 volumes reappeared. All four shop services are healthy, 19 menu items and 5 complete order rows match the pre-recovery backup, and Rocket.Chat/MongoDB are running again. Only this attempt's cache records/dependency cache and CUDA diagnostic image were removed; no volumes were pruned. About 31 GB is free on C:.

Use `E:\shawarma-pitch-tooling` for portable Python, dependencies, caches, temporary files, and the Hugging Face speech model. `scripts/pitch/install-neural.ps1` and `run-neural.ps1` configure those locations. The eight narration WAVs are complete; the reference voice and first two scenes came from the official Qwen demo, and six scenes used the local 0.6B Base model on the RTX 3060. The hosted fallback can exhaust its free GPU quota. Both pitch artifact directories are now on E: under `E:\shawarma-pitch-tooling\video`, with workspace NTFS junctions keeping existing paths usable; V2 Compose binds E: explicitly. Never move or remove the original generated images in `.codex/generated_images` as part of speech cleanup. See `docs/PITCH_VIDEO.md` for progress and reproduction.

- `README.md`: setup, features, development, scope.
- `docs/OPERATIONS.md`: staff credentials, backups/restore, monitoring, retention, deployment constraints.
- `docs/DEVELOPMENT.md`: current Docker/Vite hot reload, startup/mode switching, dependency volume, and isolated verification.
- `docs/API.md`: endpoint/payload contracts.
- `docs/DESIGN.md`: interface principles, typography provenance, responsive behaviour, interaction rules, and design verification.
- `docs/MENU_SOURCE.md`: the dated Yandex catalogue, photo provenance, explicit transactional import, and preserved data invariants.
- `docs/TEST_RESULTS.md`: current verification evidence and limits.
- `docs/DEPLOYMENT.md`: selected per-business GitHub/Netlify/Neon setup, pooled/direct database URLs, preview isolation, launch checks, and Go runtime lifecycle constraint.
- `docs/PITCH_VIDEO.md`: Russian owner-pitch storyboard, portrait MP4 sources/artifacts, isolated app capture, regeneration, and free editing workflow.
- `docs/OUTREACH.md`: first-customer prospect research, editable Excel workflow, contact-verification limits, offer proposals and handoff precautions.
