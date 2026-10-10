# Я люблю шаверму

A pickup ordering app built with React, TypeScript, Vite, Go, PostgreSQL, and nginx. Source is included locally; this folder does not currently contain a Git repository.

## Run on Windows

Install Docker Desktop and start it. If your existing `.env` is present, keep it.

```powershell
docker compose --profile operations up -d --build
```

For a fresh checkout, install Node.js 22.12+ and run `node scripts/setup-env.mjs` first to generate random local credentials.

- Customer app: http://localhost:5173
- Kitchen: http://localhost:5173/kitchen
- Health through the web proxy: http://localhost:5173/api/health
- Kitchen password: your local `KITCHEN_PASSWORD`, unless named staff accounts are configured.

Orders and menu edits persist in the PostgreSQL volume. `docker compose down` stops the app while retaining its database volume. The operations profile additionally runs daily backups into `backups/`.

## Vite hot reload — current local mode

The frontend now runs Vite at **http://localhost:5173**, connected to the existing shop API/database. Save changes in `src/` to see them update automatically. Docker supplies Node and uses a separate Linux dependency volume; no host npm installation is required.

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations up -d --build
```

Keep both Compose files when starting/rebuilding the development setup. Running only the base file switches back to the built nginx frontend. Backend source changes still need an API rebuild. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for mode switching, dependency updates, and verification.

## What the app does

- Menu-first storefront with two-column mobile food cards, desktop basket/mobile sheet, categories, product customization/quantity details, image fallback, and persistent cart. Inter Variable is bundled locally with Cyrillic support.
- Optional product customizations and extras, independently counted variants, server-checked prices, preserved historic receipts, 20 items per variant and 50 total items per order.
- Guest checkout with name and an optional note; payment at pickup.
- Safe retry after a lost response: identical key, payload, and total survive a page reload. The pending order stays fixed until the server confirms it or definitively rejects it.
- Private tracking, recent links saved on this device, live preparation estimate, delayed-order messaging, cancellation reasons, and directions/contact details when configured.
- Mobile kitchen navigation, queue filters/counters, 5/10/15/20/30-minute preparation shortcuts, quick availability switches, cancellation suggestions, overdue markers, and new-order notices/sound.
- Staff product editing, ingredient/allergen fields, option pricing, availability, shop details, opening hours including overnight shifts, and manual pause.
- Shared demo login or named staff logins with transactional attribution of order/menu/settings changes.
- Versioned transactional migrations, service health checks, optional daily backups, and automatic expired-session/rate-limit cleanup.

Customer status and kitchen orders refresh every five seconds after each completed request. Terminal customer orders stop automatic status polling. Menu data refreshes every 15 seconds and reconnects when internet returns or the tab becomes visible. Mobile browsers may suspend background pages; sound is not a push notification.

Original shop setup: **Я люблю шаверму**, **Белорусская ул., 4, Санкт-Петербург**, **09:00–22:00 Moscow time** (interpreted as daily). The city/address match the user-supplied Yandex Maps listing. The current kitchen-configured name is **Я@Ша**; the catalogue import preserves it. `config/shop.json` retains the original setup/name, so review it before overwriting current staff settings. Apply that setup locally with:

```powershell
docker compose -f compose.yaml -f compose.tools.yaml run --rm frontend-tools node scripts/configure-shop.mjs
```

The script preserves other settings and requires the shared local kitchen login. For named accounts, use Kitchen → Settings. The running app uses **19 items with prices, portion sizes, and locally hosted photos** from the user-selected Yandex Maps menu, checked on 2026-10-10; demo mode is disabled. A fresh database starts with demo fixtures until the explicit [catalogue import](docs/MENU_SOURCE.md) is applied. Phone and ingredient/allergen information remain unset. Photo provenance: `public/images/CREDITS.md`.

## Development and verification

The Docker/Vite workflow above is the current setup. For the alternative host workflow with Node.js 22.12+, Go 1.25.5+, and Docker, first stop the container frontend to free port 5173:

```powershell
docker compose -f compose.yaml -f compose.vite.yaml stop web
```

Then run:

```powershell
npm ci
docker compose -f compose.yaml -f compose.dev.yaml up -d db
node scripts/run-backend.mjs
# In a second terminal:
npm run dev
```

For a Wi-Fi phone preview, set `PUBLIC_ORIGIN=http://YOUR_PC_LAN_IP:5173` and restart Go. Open that exact origin on the phone. Checkout keys work on this HTTP preview; clipboard access may require copying the link from the address bar.

Frontend checks:

```powershell
npm run check
```

Backend checks with PostgreSQL available:

```powershell
cd backend
go test ./...
go vet ./...
cd ..
```

Set `TEST_DATABASE_URL` to run integration tests; otherwise those tests explicitly skip. They create and clean isolated schemas. For Docker-based checks without host Node/Go:

```powershell
docker compose -f compose.yaml -f compose.tools.yaml run --rm frontend-tools npm ci
docker compose -f compose.yaml -f compose.tools.yaml run --rm frontend-tools npm run check
docker compose -f compose.yaml -f compose.tools.yaml run --rm backend-tools go test -v ./...
```

Run browser tests in their own disposable database:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml up -d --build db api web
docker compose -p shawarma-review -f compose.e2e.yaml run --build --rm browser
docker compose -p shawarma-review -f compose.e2e.yaml down
```

The browser test database lives in tmpfs and is discarded when its container stops. It has no public port and never connects to the shop database. Browser tests exercise checkout, tracking, kitchen management, options, response-loss retries, paused/closed intake, keyboard focus, and responsive layouts. Screenshots are saved in `artifacts/`.

The existing GitHub Actions workflow runs frontend, PostgreSQL-backed Go/race checks, and browser tests if this source is added to a GitHub repository.

## Operations and boundaries

Design principles and interaction rules are documented in [docs/DESIGN.md](docs/DESIGN.md), including Russian ordering-app references, the verified RWB font family, responsive behaviour, and the difference between immediate order shortcuts and draft settings controls.

Read [AGENTS.md](AGENTS.md) first when handing this project to another agent. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for named staff accounts, backups, restoration, health, retention, and public deployment setup. API contracts are in [docs/API.md](docs/API.md). Verification evidence is in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

This app handles one pickup shop. It does not include online payments, delivery, customer accounts, SMS/push, multiple shops, distinct staff permission levels, or financial reconciliation. Customers need their private link to retrieve an order. “Мои заказы” shows all links still saved in this browser, newest first, with order numbers and Moscow dates/times. Token-only entries from the old format recover their number/date through the private tracking endpoint; opening a personal tracking link also saves it here. History does not sync between devices, and clearing browser storage removes it. Orders discarded by the former five-link limit can only be restored by opening their original personal links.

For a public launch, supply verified shop information and original product photos, configure HTTPS, individual staff access, an off-machine backup destination, and uptime alerts. The Netlify adapter remains included as an alternative build target; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and recheck platform support before choosing it.
