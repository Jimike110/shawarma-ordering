# Architecture and code placement

This repository contains one React customer/staff application, a Go API and a private Android kitchen wrapper. One deployment serves one business. The website and Telegram Mini App share customer features; staff access and native device credentials remain separate.

The structure applies the useful parts of the [folder-structure guide](https://xcodx.io/blog/best-practices/folder-structure-best-practices): group related features, colocate tests, keep dependencies explicit and separate source from generated output. It does not require a JavaScript monorepo framework or a new deployment architecture.

## Repository map

```text
src/
  app/                 # HTML entry modules, routes, provider/layout composition, recovery
    styles/            # Existing global CSS and optional brand preview
  features/
    analytics/         # Metrics, charts, history/activity views and pure date-series logic
    auth/              # Staff login, password forms, guards and leaf context identities
    cart/              # Store baskets, pricing/display helpers and basket UI
    catalog/           # Customer menu, product editing, toppings and menu provider
    checkout/          # Checkout and immutable persisted retry attempts
    devices/           # Owner administration of shared kitchen access/devices
    kitchen/           # Queues, order actions, repeating audio, native bridge and health
    locations/         # Pickup picker, map, preferred store and pickup information
    orders/            # Private tracking and browser-local order history
    owner/             # Owner navigation, accounts/store controls and reusable owner UI
    privacy/           # Public documents, owner privacy workspace and document contracts
    stores/            # Manager/owner store-settings editor
    telegram/          # Memory-only customer session/permission bridge and status entry
  shared/
    api/               # HTTP client and contracts consumed across features
    hooks/             # Domain-independent hooks, including serialized polling
    lib/               # Pure formatting and random request-key generation
    ui/                # Small reusable controls with no feature imports
  test/                # Unit-test environment setup
backend/
  cmd/                 # Executable adapters: server, function and administrative CLIs
  internal/
    app/               # Application operations, HTTP adapters, authorization and transactions
    database/          # PostgreSQL connections and embedded migration sources/runner
android-kitchen/       # Kotlin WebView, Keystore, monitoring service and Android build
public/                # Unprocessed font, image and kitchen-audio assets; licences
config/                # Reviewed initial menu/shop snapshots, never live settings
scripts/               # Setup, import, build, backup and verification entry points
tests/e2e/             # Cross-feature Playwright workflows
docs/                  # Durable development/operations/security guides
artifacts/             # Ignored review output and local business/pitch material
```

Root HTML, package/compiler/provider configuration, Dockerfiles and Compose files remain stable entry points for existing commands. `README.md` is the documentation index; `AGENTS.md` holds concise safety rules and handoff context. Do not put daily progress logs in either.

## Frontend dependencies

`app` composes features; features use shared modules. Shared modules cannot depend on features or application composition. A feature must not import `app`. Cross-feature imports are allowed when they express a real dependency and do not create runtime cycles. Prefer extracting a small lower-level module to importing another screen's entire implementation.

Import exact modules using `@/features/...` or `@/shared/...`; the alias is configured in TypeScript and Vite/Vitest. A relative import within one feature is also valid. Avoid deep relative paths, giant root barrels and re-exporting screens just to reach a helper.

Keep component files PascalCase and plain helpers/hooks camelCase. Tests sit beside their subject as `*.test.ts`/`*.test.tsx`; browser workflows stay in `tests/e2e`. New feature-specific CSS belongs with that feature. Existing global CSS retains its cascade order; moving a component is not permission to redesign it.

Context identity modules must remain independent of their provider's descendant components. `authContext.ts`, `storeContext.ts` and `ownerContext.ts` are deliberately separate: importing the provider through a consumer previously broke staff authentication during hot updates.

Pure report calculations live in `analytics/reportSeries.ts`, so calculation tests do not load report screens. The shared HTTP client does not own feature state. Browser storage, native bridges and network operations must not be hidden inside a module described as a pure calculation.

## Go responsibilities

`internal/database` owns connection setup and migration execution. `app.Open` and `Store.Migrate` delegate to it so command interfaces stay stable. SQL file contents, migration order and recorded version names remain unchanged; moving their source directory is not a new database migration.

`internal/app/api.go` registers routes; `http.go` supplies decoding/error responses. Domain-prefixed files make operations discoverable: `orders_http.go` handles order requests, `orders_store.go` owns order persistence, `catalog_*` owns menu operations, `accounts_*` owns staff accounts and `reports_*` owns reporting. Privacy and Telegram files retain their domain prefixes. Keep HTTP parsing/response work in adapters and use plain arguments/context in storage/business functions.

The application remains one Go package for operations sharing authorization and transactions. Checkout must atomically preserve order snapshots, consent, retries and notification outbox entries. Do not split those writes into independent commits merely to create more folders. Extract a new Go package when it has a coherent API and can depend inward without importing `app`; Go's compiler enforces package-cycle boundaries.

## Adding or moving code

1. Choose the owning feature or backend responsibility before creating a file. Promote code to `shared` only when it is reusable and has no feature dependency.
2. Split independent components or calculations from a mixed file. Avoid empty `components/hooks/services/utils` scaffolding for a feature with only one or two modules.
3. Update imports, HTML entry paths, mocks, HMR fault-injection paths, build inputs and guide links together. Preserve route URLs, API contracts, browser-storage keys, SQL migration versions and privacy journal signatures.
4. Run `npm run check:structure`; `npm run check` also runs it. The check rejects misplaced source roots, unresolved/case-mismatched imports, invalid shared/feature dependencies, production imports of tests and runtime import cycles.
5. Run affected Go/PostgreSQL and isolated browser checks using the [testing guide](TEST_RESULTS.md). HMR tests may edit only a disposable source copy. Never use a structure refactor to reset data, rotate secrets, deploy or activate retention.

Keep environment secrets, signing keys, generated bundles, screenshots, local originals and operator-specific material out of Git. Only the explicit durable-guide allowlist under `docs/` is tracked; outreach and pitch guides remain local.
