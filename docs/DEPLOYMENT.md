# Optional deployment: GitHub + Netlify + PostgreSQL

No repository, hosting account, database service, or deployment was created for this delivery. The commands below are for you to run when you decide to publish.

## 1. Create a repository

Create an empty repository in your own GitHub account. From the extracted project folder:

```powershell
git init
git add .
git commit -m "Build shawarma ordering MVP"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/shawarma-ordering.git
git push -u origin main
```

Check that `.env` is ignored before pushing. Source photos, lockfiles, tests, Compose, and build scripts should be committed. CI contains only disposable test credentials.

## 2. Provide PostgreSQL explicitly

Netlify static hosting/functions do not make this app's PostgreSQL database appear automatically. Use an existing PostgreSQL service you control, or choose a database service yourself. Review its billing terms yourself; this guide provisions nothing.

Use PostgreSQL 17 or newer and a connection URL with TLS, for example:

`postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require`

A serverless-compatible pooler is useful. Each warm Go function instance uses a pool capped at 4 connections. Ensure the database can accept the total across instances.

Apply the schema once from a machine that can reach the database:

```powershell
$env:DATABASE_URL = "YOUR_POSTGRES_CONNECTION_URL"
cd backend
go run ./cmd/migrate
cd ..
```

The migration includes demo products and uses `ON CONFLICT DO NOTHING`; rerunning it does not replace staff product edits. The function does not run migrations on every request.

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

| Variable           | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL`     | TLS-enabled PostgreSQL connection URL                                      |
| `KITCHEN_PASSWORD` | A unique password, 12–72 UTF-8 bytes                                       |
| `SESSION_SECRET`   | At least 32 random characters; keep it stable                              |
| `PUBLIC_ORIGIN`    | Exact origin, e.g. `https://YOUR_SITE.netlify.app`, with no trailing slash |
| `COOKIE_SECURE`    | `true`                                                                     |

Alternatively use `KITCHEN_PASSWORD_HASH` with a bcrypt hash instead of `KITCHEN_PASSWORD`. Secrets belong in Netlify environment settings, not in `netlify.toml`, the frontend, or GitHub source.

`PUBLIC_ORIGIN` intentionally permits exactly one origin for staff mutations. Deploy previews need a matching origin and isolated test database to exercise the kitchen. Do not point PR previews at the live shop's database.

You can verify the artifacts locally first:

```powershell
npm ci
npm test
npm run build:netlify
```

This builds only. It does not deploy. The Linux function binary is not executable directly on Windows.

## 4. Verify after your chosen deployment

Open the menu, submit a test order, save its tracking link, sign in to the kitchen, and advance the order. Confirm that the open tracking page updates without a manual refresh. Test a paused shop and an unavailable product.

## Netlify support limitation

As checked for this delivery on October 10, 2026, Netlify's documentation sends Go authors to the Lambda-compatible API. That page says Lambda compatibility deployments will no longer be accepted from July 1, 2027. This package therefore contains the current Go path, with that lifecycle limitation made explicit.

Before deploying later, recheck the official documentation. For a long-lived alternative, run the included Go server plus PostgreSQL and serve the Vite build through the included nginx container. For another serverless provider, the existing Go Lambda adapter is a starting point; request/event routing is provider-specific.

Official references:

- https://docs.netlify.com/build/functions/get-started/
- https://docs.netlify.com/build/functions/lambda-compatibility/?fn-language=go
- https://docs.netlify.com/build/functions/configuration/

No live Netlify deployment was used to verify this package. Local compilation and adapter tests cover the supplied build and routing code; live platform/database connectivity must be checked after your own deployment.
