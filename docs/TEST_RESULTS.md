# Verification results

**Latest session check (2026-10-10):** reproduced HTTP 401 when a shared-password login created under one `LoadConfig()` was validated under a second independently salted configuration. After separating session identity from bcrypt salt, the new PostgreSQL-backed regressions pass: shared login survives instance changes and can access protected orders; password or secret changes reject the old session; logout revokes it for both instances. Explicit password-hash reload and rotation also pass. Existing named-staff revocation/audit, complete PostgreSQL API workflow, secure-cookie/configuration, trusted-proxy, missing-database-URL, and Netlify routing/cookie regressions passed in the same focused run. Tests used isolated schemas in the disposable `shawarma-review` database, never the real shop or Neon. No frontend changes were made, and live Netlify login/reload has not been verified. The full backend suite still has the unrelated checkout-name expectations described below.

The corrected backend also passed `go vet ./...` and a Linux Netlify function build with `CGO_ENABLED=0`. The disposable database was stopped after verification.

**Latest shop-transfer check (2026-10-10):** `scripts/prepare-shop-transfer.mjs` read the local public API, verified all 19 photo checksums, and prepared public-only JSON/SQL artifacts. In the separate `shawarma-review` PostgreSQL 17 database, an intentional audit-insert failure rolled back catalogue/settings changes and preserved an existing synthetic order. A successful run imported 19 products with current settings and the unavailable Рыба-Фиш item; reapplying retained all product IDs/data, settings, and the complete original order snapshot. Differing target settings and product edits each caused the expected refusal. The import was not applied to the real local database or Neon. These targeted checks do not resolve the existing checkout-name test mismatch below.

**Latest backend check (2026-10-10, migration configuration fix):** the missing-`DATABASE_URL` guard and focused Go adapter/proxy regressions passed. The full Go unit run currently fails the two existing checkout-name assertions (`empty_name` and `long_name`): they expect rejection, while current checkout validation permits those names. PostgreSQL integration tests were intentionally skipped for this check (`TEST_DATABASE_URL` empty); no migration or database mutation was performed. Earlier backend results in the table below predate this name-validation mismatch. Frontend behavior was not changed by the database-URL guard.

Verified locally on **2026-10-10** using Docker Desktop, PostgreSQL 17, Node 22, Go 1.25.5, and headless Chromium. No external deployment was performed.

| Check                                                  | Result                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Frontend unit tests                                    | **22 passed**                                                                              |
| TypeScript and Vite production build                   | Passed                                                                                     |
| Go unit and real PostgreSQL integration tests          | Passed                                                                                     |
| Go race detector (`go test -race ./...`)               | Passed with PostgreSQL integration enabled                                                 |
| Go static analysis (`go vet ./...`)                    | Passed                                                                                     |
| Standalone API/migration Docker build                  | Passed                                                                                     |
| Linux amd64 Netlify function build and adapter tests   | Passed                                                                                     |
| End-to-end browser scenarios                           | **14 passed**, no retries; see separate history page pass                                  |
| Responsive storefront                                  | Checked at **320, 390, 768, 1440px**                                                       |
| Local shop preview after applying confirmed settings   | No horizontal overflow or page errors at all four widths                                   |
| Pre-upgrade backup restoration and migration           | Passed; existing order count stayed **1 → 1**, migration ledger has 2 versions             |
| Daily backup service and post-upgrade on-demand backup | Successful, service healthy                                                                |
| Local proxy health and shop settings                   | `/api/health` returns `status: ok`; name/address/daily hours match confirmed configuration |
| npm dependency audit during installation               | 0 reported vulnerabilities                                                                 |

Backend/race/backup evidence below comes from the earlier production-readiness pass on the same day. The later design pass changes frontend screens, typography, and UI shortcuts; it rechecks frontend tests/builds and browser workflows, without changing backend contracts. Tests use isolated PostgreSQL schemas or a separate `shawarma-review` Compose project with a disposable tmpfs database. The restore test used a separate database in that disposable stack, never the live shop database.

## Coverage

Frontend tests cover persisted cart recovery/validation, option-aware variants and totals, cart limits, polling cleanup, avoiding overlapping requests, connectivity recovery, retained data during failures, and clearing data when the private tracking link changes. History tests additionally cover legacy recovery despite malformed storage, metadata validation/deduplication, retaining more than five orders, newest-first ordering after viewing an old order, storage write failures, change notifications, recovery of token-only numbers/dates, connectivity retries, other-tab updates, aborting late recovery responses, and keeping the home count reactive without fetching old order metadata.

PostgreSQL integration tests cover checkout idempotency and concurrency, rollback, stale prices, unavailable products, snapshots, options, manual pause, normal/overnight schedules, retries after closing, preserving old active orders despite more than 300 recent closed orders, named staff attribution/revocation, cancellation reasons, migration preservation, session cleanup, opt-in retention, and protection of active orders. Existing API tests also cover passwords, Origin checks, private tracking, secure cookies, session expiry/logout, and persistent rate limits.

Browser scenarios:

1. Lost checkout response, HTTP 429, reload, and exact-payload retry create one order; cancellation reason reaches tracking.
2. Product options have separate quantities and correct totals; receipts retain old option prices after editing.
3. Paused/closed intake blocks additions and server checkout while allowing cart removal.
4. Storefront layouts fit four widths; native dialogs close with Escape and restore focus; no page errors occur.
5. Staff edit ingredients/options/shop settings; new-order notices and overdue queue markers appear; cancellation uses a reason.
6. Mobile checkout, automatic tracking refresh, kitchen ETA/status changes, menu availability/pricing, pause/resume, completion, and logout work together.
7. Unauthenticated kitchen requests are rejected.
8. The locally hosted Inter font loads for Cyrillic/ruble text; product options and a three-item selection total correctly; checkout and desktop basket fit four widths.
9. Kitchen ETA presets persist the selected number of minutes; availability switches persist stock; settings presets remain draft-only until saved; copying Monday's hours creates seven shifts. Queue, settings, and the options editor fit phone/tablet/desktop widths.
10. Legacy token-only order №101 recovers its number/date; eight saved orders survive reload and an older tracking visit in newest-first order, with no horizontal overflow at all four widths.
11. Opening personal tracking links saves them; switching between links does not copy the previous order's number onto the new link while its response is pending.
12. An unavailable legacy order retains its personal link and uses «Заказ по личной ссылке» rather than «Последний заказ».
13. Empty history remains accessible from the home shortcut, provides a menu action, supports direct `/orders` URLs/reloads, and redirects old `/#orders` anchors.
14. Eighty saved orders only add a count to the home screen; all eighty remain accessible on the separate history page in newest-first order.

Screenshots in `artifacts/` include `storefront-*.png`, `kitchen-settings.png`, `kitchen-queue.png`, and `shop-*.png`. The `shop-*` set captures the running local app with **Я люблю шаверму**, **Белорусская ул., 4**, and daily **09:00–22:00**. The store correctly shows closed outside those hours. Screenshots of the isolated test kitchen contain temporary fixture information that was restored after the test.

## Reproduce

### Migration configuration fix

`app.Open` now rejects blank/whitespace database URLs before invoking the PostgreSQL driver, preventing accidental localhost/OS-user fallback when running migrations or starting the API. `docs/DEPLOYMENT.md` now includes Git Bash/MINGW64 secure-prompt instructions alongside PowerShell examples. Go does not automatically load `.env`; the intended target URL must be exported in the same shell. Local Git was verified as initialized on `main`; remote service status was not inspected.

Focused verification passed without database access:

```powershell
docker compose -f compose.yaml -f compose.tools.yaml run --rm -e TEST_DATABASE_URL= backend-tools go test ./... -run 'TestOpenRequiresExplicitDatabaseURL|TestProxyPreservesRoutingBodyAndCookies|TestTrustedProxyClientIP' -count=1
```

The full unit run exposed the two pre-existing checkout-name expectation failures noted above. No real shop or Neon database was migrated or modified by this verification.

### Separate order history page

The latest pass on 2026-10-10 moves history out of the catalogue to `/orders`. The home screen keeps a shortcut/count, and tracking offers “Все мои заказы”. History recovery runs on its own page; the home count subscribes to storage updates without fetching legacy receipts. Existing links/storage and checkout behavior remain intact.

- **22 frontend tests passed**, including the new count-only subscription check; TypeScript checking and the production build passed.
- All **14 browser scenarios passed in one run**, with no retries, through Vite in the fresh disposable database. The five history cases cover legacy recovery, reload persistence, older-order sorting, private-link switching, unavailable links, empty/direct/legacy-anchor navigation, and an 80-order history absent from the home screen. Existing checkout/retry, kitchen, and responsive scenarios also passed.
- The history page fits **320, 390, 768, 1440px**; screenshots are `artifacts/orders-{width}.png`. The phone and desktop captures were visually inspected. These contain synthetic order receipts from the test shop, not actual customer orders.
- The live `/orders` URL returns **200** with the Vite client, and `/api/health` reports `ok`. No order was submitted to the real shop database.

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml down
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml run --build --rm browser sh -c 'npm run check && npm run test:e2e'
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml down
```

### Order history fix

The later history pass on 2026-10-10 removes the five-link truncation, automatically repairs token-only entries, saves metadata when tracking is opened, and makes browser/device scope explicit in “Мои заказы”. Backend contracts and checkout idempotency remain unchanged.

- **21 frontend tests passed**, with TypeScript checking and the production build, in the Linux browser image.
- All **9 existing browser scenarios passed** through Vite in the disposable database. The initial full run also passed two history scenarios; its remaining history assertion incorrectly assumed one initial request in development StrictMode, which can abort and repeat the effect. The assertion now verifies that reloading complete, persisted history adds no further request.
- All **3 final history scenarios passed** in a focused rerun with no automatic retries. They use synthetic 43-character links and mocked tracking receipts, not actual customer orders. Coverage includes №101 metadata backfill, an eight-order history, reload persistence, older-order ordering, four responsive widths, personal-link registration, link switching, and unavailable links.
- Live Vite, API, database, and backup services remained healthy. No test order was submitted to the real shop database.

Combined check (fresh disposable stack):

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml down
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml run --build --rm browser sh -c 'npm run check && npm run test:e2e'
```

The focused rerun used the already-built browser image plus the corrected test source:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml run --rm --no-deps -v './tests:/app/tests:ro' browser npm run test:e2e -- tests/e2e/history.spec.ts
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml down
```

History is local to the browser, without account/device sync. Clearing storage removes links. Entries already discarded by the old five-link limit cannot be discovered by order number; opening their original personal links restores them.

### Yandex catalogue pass

The later catalogue import on 2026-10-10 changed content and local photo assets, without changing backend contracts or customer flow logic. Verification for this pass:

- The running public API matches all **19** manifest names, prices, portion sizes, categories, and photo paths. All 19 served JPEGs match their recorded SHA-256 checksums. Demo mode is off; current kitchen name/address/seven opening shifts remain preserved.
- Importing twice in the disposable database kept exactly 19 imported products and IDs **4–22**, with no duplicates. Stock/composition edits survived reapplication. A further guarded-removal check preserved a demo row with an edited description and a demo row marked unavailable, removing only the untouched fixture.
- The real database was backed up immediately before and after import. Both pre-existing orders remained **2 → 2**; a digest of their IDs/item snapshots/totals stayed unchanged. The earlier **1 → 1** restoration result above belongs to the earlier upgrade, before a second shop order existed.
- The current web Docker production build passed. **11 frontend tests** passed in the Linux browser image; the initial Windows bind-mounted run timed out starting Vitest workers, before executing tests. The catalogue pass also switches the pickup banner to an actual catalogue photo and corrects the search icon/input spacing exposed by the expanded menu. The earlier 9-scenario browser result above remains from the design pass.
- `scripts/verify-menu.mjs` checked the actual running shop at **320, 390, 768, 1440px**, with no horizontal overflow/page errors; it checked menu search and a fresh guest basket/checkout containing two pitas and one fries for **710 ₽**. No order was submitted and no staff session/settings were touched.
- Captures: `menu-{320,390,768,1440}.png`, `menu-viewport-*.png`, and `menu-checkout-390.png`. Full-page capture scripts explicitly request lazy images below the viewport before decoding, avoiding a wait on unrequested offscreen images in the expanded catalogue.
- After the banner/search adjustment, the final source passed all 11 frontend tests and both production builds again. The running-shop check also requires the banner to use a `/images/menu/` photo and confirms a 40px search icon gutter at each width.

Recheck the imported running shop without mutations:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml run --rm --no-deps -v './scripts:/app/scripts:ro' -v './config:/app/config:ro' browser node scripts/verify-menu.mjs
```

The script accepts local targets only, never authenticates staff, and never submits an order. Its basket exists only in its temporary browser context. If the shop is closed/paused, it reports the basket/checkout portion as skipped. See `docs/MENU_SOURCE.md` for explicit import commands.

### Vite development pass

The running local frontend was switched to `compose.vite.yaml` on 2026-10-10. Only `web` was replaced; the existing API/database/backup services and 19-item shop catalogue remained in use.

- `scripts/verify-dev.mjs` connected to the actual Vite WebSocket, appended a unique CSS property through the Windows source bind mount, saw it appear without navigation, removed the exact probe block, and saw it disappear without navigation. No probe remains in the source. It never logged staff in or submitted an order.
- HTTP checks confirmed `/@vite/client`, healthy API forwarding, all 19 live catalogue items, and HTTP **403** for environment/backup-file probes. The frontend remains published only on `127.0.0.1:5173`; the API/database remain private. Current shop name Я@Ша and demo mode off were preserved.
- The final Vite configuration passed **11 frontend unit tests**, TypeScript checking, and a Vite production build in the Linux browser image.
- All **9 browser scenarios passed through Vite**, with no retries, using `compose.e2e.vite.yaml` and the disposable test database. Coverage includes guest checkout/retry/private tracking, correct prices/receipt snapshots, kitchen authentication/edits/availability/preparation/schedule controls, font loading, responsive layouts, and keyboard dialogs. No browser test order was created in the shop database.

Reproduction and mode-switch commands are in `docs/DEVELOPMENT.md`. The combined isolated check used:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml run --build --rm browser sh -c 'npm run check && npm run test:e2e'
```

Additional redesign captures: `product-mobile.png`, `checkout-{320,390,768,1440}.png`, `admin-orders-*.png`, `admin-settings-*.png`, and `admin-product-320.png`. These use the isolated test shop. Font loading was checked with Cyrillic/ruble text. Responsive assertions cover checkout, desktop basket, kitchen queue, settings, and options editor as well as the storefront. Narrow schedule fields use a day heading above the two time inputs so native 12-hour controls have room as well.

After the final narrow schedule-field adjustment, the production build and both focused design scenarios passed again. A close-up (`schedule-320.png`) verified the native time controls. The updated running shop was captured at all four widths with no horizontal overflow or page errors; proxy health returned `ok`, and the confirmed shop name/address/seven shifts were preserved.

See `AGENTS.md` and `README.md` for standard checks. The combined container check used:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml down
docker compose -p shawarma-review -f compose.e2e.yaml run --build --rm browser sh -c 'npm run check && npm run test:e2e'
```

The first command resets only the disposable test stack, giving each full run a fresh tmpfs database and fresh persistent rate-limit counters. Reusing the test database across runs within 10 minutes can exhaust its legitimate staff-login limit. Do not change production limits to accommodate tests. Reports/traces are stored under `artifacts/playwright-report` and `artifacts/test-results`.

Read-only previews of the running local shop:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml run --rm -v './scripts:/app/scripts:ro' browser node scripts/capture-preview.mjs
```

The preview script only accepts local hosts and does not sign in, edit settings, or place orders. Stop the disposable stack afterward with `docker compose -p shawarma-review -f compose.e2e.yaml down`. Keep the actual shop/backup stack running.

## Limits and launch work

These checks establish local correctness for the tested workflows. They do not establish production load capacity, uptime, real-device Safari behavior, or public HTTPS operation. Browser checks used Chromium, not a physical phone. A broader accessibility audit and load test have not been performed.

The 19-item menu/prices/photos/portion sizes were imported from the user-selected Yandex Maps listing on 2026-10-10, matching the Saint Petersburg address. Demo mode is disabled in the running shop. Staff must confirm current stock, phone, complete ingredient/allergen information, and weekly exceptions to the user's daily hours. The import preserved current kitchen settings, including the Я@Ша name; the original setup file still contains Я люблю шаверму.

The user subsequently supplied the HTTPS deployment `https://shawarma-ordering.netlify.app` and function logs on 2026-10-10. The function executes but fails database initialization, falling back to the Netlify sandbox user and a local `/tmp` PostgreSQL socket instead of Neon. The runtime configuration fix is documented in `DEPLOYMENT.md`; successful hosted database connectivity, migration/menu transfer, and HTTPS staff cookies remain unverified. A direct API fetch through the web tool was unavailable, so this diagnosis uses the supplied logs rather than a successful live API check. Individual production staff credentials, encrypted off-machine backups, and external uptime alerts remain to be verified/configured. The local Git repository is initialized on `main`; GitHub remote configuration and actual CI execution were not checked.
