# Developer and agent handoff

Read this file before making changes. Keep it concise and current; put durable explanations in the linked guides, not a running transcript of work.

## Project

This is an existing **React/TypeScript + Go + PostgreSQL** pickup-ordering application. Continue the implementation in this repository. It is not a Sites/Floot-hosted project; do not register or publish a replacement site.

One deployment/database serves one business with multiple stores. Customers are guests and pay at pickup. Staff have database-backed owner/manager/worker accounts. A non-owner can hold different roles at different stores.

Use [README.md](README.md) as the documentation entry point. Development, operations, API, design, testing, deployment and privacy each have their own guide.

## Current scope and decisions

- First-time customers choose a pickup point using the map/list picker; `/locations` always reopens it. The header opens the same picker. Keep explicit store/QR links, per-store baskets and frozen checkout attempts. Location permission is gesture-only; never persist guest coordinates. Store pins/landmarks/entrances are manager/owner settings, not worker controls.
- `/orders` holds browser-local history. Private links use `/track#TOKEN`; order numbers are not lookup credentials.
- Staff enter at `/kitchen`. Owner routes are `/owner`, `/owner/stores`, `/owner/staff`, `/owner/analytics` and secondary `/owner/privacy`.
- Guest names/comments are optional and require separate consent. Unpublished privacy documents block new intake.
- Privacy erasure requires explicit activation and maintenance; document publication does not enable it.
- Kitchen sound is implemented and starts enabled. **Customer sound/vibration was removed by the user.** Do not restore it implicitly.
- Trial kitchens use one store-bound shared account and owner-approved devices; personal owner/manager accounts remain. Remembered access has a 30-day absolute deadline. Password rotation/device revocation must stop web access and native monitoring. Audit the account and device, not a claimed employee identity.
- Kitchen alerts repeat every 15 seconds until no `new` orders remain. Offline devices do not stop intake. See `android-kitchen/README.md` for signing, installation and mandatory actual-tablet acceptance. Never commit signing secrets or claim unconditional sound delivery.
- Canonical toppings share availability across dish extras and a standalone product. Preserve legacy options, receipt snapshots and store-local copying. Owner menu/compositions still require review before import.
- Olive/Lobster branding is an opt-in `?brand_preview=olive` sample pending owner approval; Inter stays operational. Do not activate it globally before that review.
- AI, delivery, online payments, customer accounts, Web Push/SMS, two-factor authentication and email invitations are outside the current implementation.
- Local development uses the base Compose file **plus `compose.vite.yaml`**. Go is not hot-reloaded.
- Netlify/Go/Neon is the existing demonstration deployment, with a separate repository/site/database per business. Russian real-data production infrastructure remains an unresolved launch requirement. Do not silently substitute a host or deploy.

The supplied shop is Я@Ша at Белорусская ул., 4, Saint Petersburg. Original brief: Я люблю шаверму, daily 11:00–22:00 Moscow time. Current database settings override historical setup files. The bundled 19-item Yandex menu is dated 2026-10-10. Never invent prices, phone numbers, ingredients or allergens; see [menu source](docs/MENU_SOURCE.md).

## Before editing

1. Inspect `git status --short`; preserve user edits and reversions.
2. Read the relevant guide and source. Runtime files and migrations take precedence over outdated notes.
3. Use isolated data for mutations/tests. Do not reset the shop database or run fixtures against production.
4. For UI work, follow [design rules](docs/DESIGN.md), Russian labels, rubles, Moscow dates and accessible mobile controls.
5. Change only what the task needs. Keep routine logs/screenshots under ignored `artifacts/`.

Do not print `.env`, passwords, cookies, tokens or connection URLs. Do not commit those files or include them in Docker images. Do not send messages to owners/prospects, publish documents, activate retention or deploy without the corresponding user instruction.

## Code landmarks

| Code | Responsibility |
| --- | --- |
| `src/main.tsx` | Routes, error boundaries and provider composition |
| `src/cart.tsx`, `src/checkoutAttempt.ts` | Store baskets and exact-payload retry state |
| `src/orderHistory.ts`, `src/useSavedOrders.ts` | Private-link history and legacy metadata recovery |
| `src/staff.tsx`, `src/ownerWorkspace.tsx` | Staff sessions/workspaces and owner layout |
| `src/auth.ts`, `src/staffStore.ts`, `src/ownerContext.ts` | Dependency-only context identities/hooks |
| `src/useKitchenSound.ts`, `src/usePolling.ts` | Kitchen audio and nonoverlapping polling |
| `backend/internal/app/api.go` | Route registration, HTTP validation and error responses |
| `accounts.go`, `stores.go`, `store.go` in that directory | Accounts, authorization, store lifecycle, reports and checkout |
| `privacy*.go` in that directory | Documents, requests, retention, journal and evidence |
| `schema.sql`, `migrations/*.sql` in that directory | Embedded transactional migrations |
| `backend/cmd/` | Server, migration, account, maintenance and function entry points |
| `kitchen_devices.go`, `toppings.go` | Shared device authorization/health and store toppings |
| `android-kitchen/` | Restricted WebView, Keystore, foreground monitor and native audio |

Keep auth context imports acyclic: screen/provider component files must not define the context identity imported by their descendants. That formerly caused “Missing staff authentication” during Vite refresh. Error recovery must not clear saved orders or resubmit checkout.

## Invariants

- The backend calculates prices. Preserve purchased product/option/name/price snapshots.
- Accepted identical retries return the existing order before current intake/privacy guards. Different payloads or another store with the same key conflict. Preserve legacy fingerprints.
- Ambiguous network/429 failures must retain the frozen payload, store and key.
- Every staff resource operation includes the authorized store constraint, including legacy aliases.
- Workers use narrow availability/operations PATCH requests; they cannot edit prices or lift owner stops.
- Preserve complete memberships when editing an account from a filtered list.
- Password/access changes revoke sessions. Protect the last active owner. Never expose existing passwords.
- Staff writes require the configured Origin. Cookies are HttpOnly, SameSite=Strict and Secure on HTTPS.
- Keep `SESSION_SECRET` stable: tracking/retry derivation, privacy journal integrity and keyed digests depend on it.
- Never fabricate historical preparation events from `updated_at`.
- Active orders must not be removed by routine retention. Keep legacy `ORDER_RETENTION_DAYS=0`; nonzero deletion is retired.
- Restore with traffic blocked, the independent current deletion journal and its original key. Replay and drain retention before reopening; see [privacy recovery](PRIVACY_OPERATIONS.md#restore-without-resurrecting-erased-data).
- Add migrations; do not rewrite migrations already applied to a database.

## Work and verification

The primary commands are in [development](docs/DEVELOPMENT.md) and [testing](docs/TEST_RESULTS.md). Use the explicitly named `shawarma-review` disposable project for browser/database checks. Never remove volumes to switch frontend modes.

On this Windows workspace, use `Get-Content -Encoding UTF8` for Russian files. Docker may require execution approval. Portable Node/Go tools may exist, but do not assume a host npm installation. Quote paths containing spaces.

Verify changes appropriate to their scope and state what was actually run. Do not cite old test totals as proof of the current revision. Hosted configuration, migrations and CI/Netlify publishing controls must be checked separately; a push can trigger production publishing even if GitHub tests later fail.

## Documentation and local material

Use English explanations with exact Russian UI labels where helpful. Keep setup commands executable, identify their working directory and distinguish local/demo/production. Do not add routine implementation diaries or operator-specific data to tracked documentation.

Pitch scripts/media, meeting documents and outreach workbooks stay ignored. Preserve `scripts/pitch/`, `Dockerfile.pitch*`, `compose.pitch*.yaml` and `artifacts/` exclusions. Do not regenerate an outreach workbook over actual notes.

Local media tooling/cache is under `E:\\shawarma-pitch-tooling`; Docker storage was moved to E:. Do not move disks, prune volumes or download large speech models as routine app maintenance. Details belong in the local [pitch guide](docs/PITCH_VIDEO.md).
