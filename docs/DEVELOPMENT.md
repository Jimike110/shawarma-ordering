# Local Vite development

The current local frontend runs **Vite with React Fast Refresh** at **http://localhost:5173**. Docker provides Node 22; no host Node installation is required. It uses the existing Go API, PostgreSQL volume, kitchen settings, menu, orders, and daily backup service.

## Start or resume

From the project directory:

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations up -d --build
docker compose -f compose.yaml -f compose.vite.yaml --profile operations ps
```

The override replaces only the `web` frontend with `Dockerfile.dev`; it does not create a different database/project. Keep the same project name and the existing `.env`. Vite listens on container port 80 to reuse the base file's localhost-only `127.0.0.1:5173:80` mapping. Its WebSocket client uses port 5173. The API and PostgreSQL have no published port in this setup.

Edit `src/` and save: styles update immediately and React usually preserves local component state through Fast Refresh. Some module/export changes trigger a full page reload. Changes to `public/` or the HTML also reload the page. The server uses 300ms file polling for Docker Desktop/Windows bind mounts, and dependencies live in the separate `frontend_dev_node_modules` Linux volume. Generated artifacts/backups/backend files are excluded from the development watcher.

The API is compiled Go and does **not** hot reload. After changing backend source, rebuild/restart that service:

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations up -d --build api
```

Staff-saved menu/settings changes still persist in PostgreSQL and appear through the existing menu polling. Vite changes the frontend serving method, not the shop data.

## Dependency changes

After editing dependencies and updating the lockfile, rebuild the development image and synchronize the Linux dependency volume:

```powershell
docker compose -f compose.yaml -f compose.vite.yaml build web
docker compose -f compose.yaml -f compose.vite.yaml run --rm --no-deps web npm ci
docker compose -f compose.yaml -f compose.vite.yaml up -d --force-recreate --no-deps web
```

Do not delete PostgreSQL volumes to fix frontend dependencies.

## Return to the built frontend

```powershell
docker compose --profile operations up -d --build --no-deps web
```

This restores nginx and the production frontend at the same URL; refresh the browser once. Running the base Compose command without `compose.vite.yaml` switches to that built mode. Keep using both files while developing. Vite is for local development; the default nginx build remains the production path.

## Verify hot reload

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml run --rm --no-deps -v './scripts:/app/scripts:ro' -v './src:/app/src' browser node scripts/verify-dev.mjs
docker compose -p shawarma-review -f compose.e2e.yaml down
```

The script checks the running local Vite client/WebSocket and API/menu, briefly appends a unique CSS custom property, checks that it appears without browser navigation, removes only that probe block, and verifies its removal. It never signs staff in or submits an order. It also checks that `.env` and backup files cannot be fetched through Vite. API proxy requests retain the browser Origin; Vite overwrites the client-IP header trusted by the private Go API.

For browser order/staff tests, use the disposable database with a Vite override:

```powershell
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml up -d db api web
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml run --build --rm browser
docker compose -p shawarma-review -f compose.e2e.yaml -f compose.e2e.vite.yaml down
```

Start these browser tests with a fresh disposable stack, as documented in `docs/TEST_RESULTS.md`. They use the bootstrap demo fixtures, not the real imported menu. No test order should be placed against the shop database.

Configuration references: [Vite server options](https://vite.dev/config/server-options), [Compose file merging](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/). Configuration uses the HMR options supported by the installed Vite 7 dependency.
