# Shawarma ordering

A pickup-ordering application for **one business with one or more stores**. Customers order without an account, follow a private tracking link, collect their food and pay at the counter. Staff use the kitchen queue; owners manage stores, staff access and reports.

The project uses React, TypeScript and Vite, a Go HTTP API, and PostgreSQL. It runs locally with Docker Compose. The interface is Russian; prices are whole rubles and business dates use Moscow time.

## Start here

| You want to… | Read |
| --- | --- |
| Run the app for the first time | [Quick start](#quick-start) below |
| Develop, configure or understand the code | [Development guide](docs/DEVELOPMENT.md) |
| Use the kitchen or owner dashboard | [Operations guide](docs/OPERATIONS.md) |
| Call an API or understand permissions | [API reference](docs/API.md) |
| Import the shop menu or transfer current settings | [Menu guide](docs/MENU_SOURCE.md) |
| Upgrade or deploy a release | [Deployment guide](docs/DEPLOYMENT.md) |
| Set up privacy documents, cleanup or recovery | [Privacy operations](PRIVACY_OPERATIONS.md) |
| Run tests and interpret their results | [Testing guide](docs/TEST_RESULTS.md) |
| Change the interface | [Design guide](docs/DESIGN.md) |
| Build/install the private kitchen APK | [Android kitchen guide](android-kitchen/README.md) |
| Configure the optional Telegram customer app/test bot | [Telegram setup](TELEGRAM.md) |
| Hand the repository to another developer or agent | [Agent handoff](AGENTS.md) |

**A working local app is not a completed production launch.** The existing Netlify/Neon setup is a demonstration deployment. Russian production infrastructure, operator approval, backups, monitoring and release checks remain separate requirements. See the [launch gates](docs/DEPLOYMENT.md#production-launch-gates).

## Quick start

These steps use **PowerShell from the repository root** and Docker Desktop with Linux containers. Host Node.js and Go are not required for this path. Keep Docker Desktop running.

### 1. Create local configuration

For a fresh checkout:

```powershell
docker run --rm -v "${PWD}:/app" -w /app node:22-alpine node scripts/setup-env.mjs
```

This creates an ignored `.env` with random local database credentials and a signing secret. It does not overwrite an existing file. Keep an existing installation's `.env`: changing the database password or signing secret is not a reset procedure.

If Node.js 22.12 or later is installed, `node scripts/setup-env.mjs` does the same thing.

### 2. Start development services

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations up -d --build
docker compose -f compose.yaml -f compose.vite.yaml --profile operations ps
```

This starts PostgreSQL, the Go API, Vite and local daily backups. The first image build may take several minutes.

Open:

- Storefront: <http://localhost:5173>
- Staff login: <http://localhost:5173/kitchen>
- Health check: <http://localhost:5173/api/health>

The health endpoint should return `{"status":"ok"}`. A fresh database contains three demonstration products and an original store with ID `1`. It does not automatically load the 19-item shop catalogue.

**New ordering is initially blocked until privacy documents are configured and published.** This is intentional, not an installation failure.

### 3. Create the first owner

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\staff-admin.ps1
```

The helper asks for a hidden password twice and creates username **owner**, display name **Владелец**. Use a password of 15–128 characters. There is no preconfigured owner password.

The execution-policy option applies only to this PowerShell process. It does not change the computer's permanent policy.

Sign in at `/kitchen`; an owner is directed to the owner workspace. Passwords are stored as hashes in PostgreSQL, not saved back into `.env`.

### 4. Configure the business

1. Open **Точки** (Stores), choose the original store and review its name, address, menu, prices and opening hours.
2. Open **Персональные данные** (Personal data) from the account menu or sidebar. Follow [privacy setup](PRIVACY_OPERATIONS.md#configure-and-publish-documents). Publishing requires the actual operator's approved details and recent owner password confirmation.
3. Create individual staff accounts and assign each a role at the relevant stores.
4. For the supplied Я@Ша catalogue, follow the [explicit import procedure](docs/MENU_SOURCE.md#import-the-bundled-catalogue). Do not assume that copying images also populates the database.

Use fictional operator details only in an isolated demonstration or test environment. Publication of documents does not make foreign hosting suitable for a real-data launch.

### 5. Stop or resume

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations down
```

The normal PostgreSQL volume survives `down`. Run the start command again to resume. **Do not add `-v`** unless you deliberately intend to remove persisted volumes.

## What is implemented

| Area | Capabilities |
| --- | --- |
| Customer ordering | Store selection in the header; independent baskets per store; product options; server-checked prices; guest checkout; payment at pickup |
| Order tracking | Private receipt link; status and ETA polling; pickup-address snapshot; cancellation messages; browser-local order history on `/orders` |
| Kitchen | Active queue; status changes; ETA presets; cancellation with a reason; availability controls; operational pause; new-order sound |
| Store management | Products, prices, options, composition fields, shop information and opening hours; permanent product deletion with confirmation |
| Owner workspace | Overview, Stores, Staff and Analytics; draft/published/archived stores; owner stops; independent menu copying |
| Access | Individual accounts, owner/manager/worker permissions, store assignments, temporary passwords and session revocation |
| Reporting | Store and combined statistics, completed-order value, trends, product totals, order history and activity |
| Privacy controls | Versioned policy/consent, optional-field consent, verified rights requests, explicit retention activation and deletion-journal recovery |

A person can manage one store and work at another. Owners can access all stores in the business. Separate businesses use separate deployments and databases.

Not implemented: delivery, online payments, customer accounts, loyalty, financial reconciliation, AI features, customer sound/vibration, Web Push, SMS, two-factor authentication or email invitations. Browser kitchen alerts require a running page. The private Android app provides native background monitoring; physical-tablet acceptance is required before relying on it in a shift.

## Important behaviour

- Order submission is retry-safe. After an ambiguous failure, retry the **same frozen payload and request key**; do not create a fresh attempt.
- Customers need the private tracking link. Order numbers alone cannot retrieve orders.
- Browser history is local to this origin and browser. Clearing storage removes saved links; there is no customer account or device sync.
- Customers may leave name/comment blank and collect by number. Entering those optional fields requires separate consent.
- A pause or owner stop blocks new orders, not fulfilment of accepted ones. Several intake blockers can apply at once.
- Analytics describe orders created during a Moscow-date range. Completed-order value is not verified revenue or profit.
- Frontend edits reload through Vite. Go changes require rebuilding the API; see [development](docs/DEVELOPMENT.md#change-the-application).

## Shop content

The supplied reference shop is **Я@Ша**, at **Белорусская ул., 4, Санкт-Петербург**. The initial configuration file still uses **Я люблю шаверму** and **09:00–22:00**. Treat it as historical setup material: the store's saved settings determine current name, hours and availability.

The bundled menu is a **2026-10-10 snapshot of 19 items** from the selected Yandex listing. Check current prices and availability with the shop. Do not invent ingredients, allergens or contact details. See [menu provenance](docs/MENU_SOURCE.md).

## Documentation scope

The guides describe repository behaviour, not the current health of a running server. Commands that migrate, import, restore, publish or erase data are identified explicitly. Documentation updates do not run those actions.

Local sales/video documents remain in ignored files: [outreach](docs/OUTREACH.md) and [pitch video](docs/PITCH_VIDEO.md). They are not part of the application deployment.
