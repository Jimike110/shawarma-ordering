# Operating the application

This guide is for the business owner, shift staff and the person maintaining the service. For first installation, use the [README](../README.md). For release procedures, use [deployment](DEPLOYMENT.md).

The business's saved database settings are authoritative. Bundled JSON files and old screenshots are not a current statement of opening hours, prices, phone numbers or stock.

## Who can do what?

| Action | Owner | Manager | Worker |
| --- | --- | --- | --- |
| Fulfil/cancel orders and change an order's ETA | Every store | Assigned stores | Assigned stores |
| Change availability, base preparation time and operational pause | Every store | Assigned stores | Assigned stores |
| Edit/delete products, prices, shop details and opening hours | Every store | Assigned stores | No |
| View full order history, activity and analytics | Every store | Assigned stores | No |
| Manage accounts, passwords and store assignments | Yes | No | No |
| Create/publish/archive stores and impose owner stops | Yes | No | No |
| Privacy documents, rights requests and retention administration | Yes | No | No |

An account may be a manager at one store and a worker at another. Owners do not need individual store assignments.

## Begin a shift

1. Open `/kitchen` or the private Android app and sign in with the shared login for this store. Owners/managers retain personal accounts.
2. On a new installation, ask the owner to approve the displayed device code. Approval is business-wide; the store's credentials determine its permitted queue. Personal accounts still replace temporary passwords when required.
3. Check the pickup address, intake state, preparation estimate and active queue.
4. Keep the kitchen page open on a powered, connected device.
5. Kitchen sound starts enabled. If the browser displays an activation control, tap it or interact with the page. Verify device volume and use visual queue notices too.

Browser audio repeats every 15 seconds while any order is **new**, including orders already present at login/reload. Viewing it or editing its ETA does not silence it; starting preparation/cancelling does. An outage preserves alerts for the last known unattended orders and labels that state unconfirmed. Stopping monitoring is explicit and leaves a warning; there is no saved permanent mute.

For locked-screen operation use the [private Android app](../android-kitchen/README.md). Entering an authenticated shared kitchen starts monitoring automatically after its initial permission/battery/speaker checks. Confirm the Android monitoring notification and visible sound state before the shift. Browser login unlocks audio during the login gesture, but browser audio remains subject to tab suspension/autoplay restrictions. Customer tracking has no sound or vibration.

### Shared kitchens and devices

Owners manage **Сотрудники → Кухни и устройства**: create one shared login per store, approve pairing codes, rotate its password, end all store sessions or revoke one device. Passwords appear once. Shared kitchens can fulfil orders, set ETA/availability and operational pauses, but cannot manage content/prices, hours, people, reports, owner stops or their own credentials. Personal owner/manager permissions are unchanged.

Remembered kitchen login has a **30-day absolute deadline**; renewable short sessions do not extend it. Rotation/disabling ends that store account's browser and native access. Revoking a lost device affects that device across this business. To move a tablet, log out/switch point and enter the destination credentials; other devices remain signed in. Audit entries identify the shared account and device, never an individual employee.

Review and disable obsolete individual worker accounts before cutover; preserve their audit history. Rotate shared credentials when staff leave or a password may have escaped, and revoke missing devices. Re-enter the new password on retained approved tablets. Keep owner/manager credentials private.

The owner overview shows coverage, including no connected devices. Heartbeats are every 15 seconds; devices become offline after 60 seconds. These are software checks, not proof of audible delivery. **Intake continues while kitchens are offline.** Check overdue queues and resolve warnings promptly.

### Tablet queue

At 1100+ CSS pixels the board has independently scrolling **Новые / Готовим / К выдаче** lanes; at 800–1099 it keeps new orders beside a switchable preparation/ready pane. Smaller screens use status filters and a persistent new-order notice. Primary controls are at least 56px; custom ETA/cancellation use accessible sheets. Test actual CSS viewport/display scaling, not physical resolution.

### Toppings

Owners/managers use **Меню → Добавки и соусы** to set composition, image, dish price/portion, standalone price/portion and explicit dish assignments. Standalone offers appear as ordinary products in that category. One availability switch controls both uses; workers can change only availability. Each selected topping is one portion per dish, multiplied by dish quantity. Existing unlinked options remain supported. Deleting the standalone offer removes its current assignments, while historical receipts retain purchased snapshots. Menu copying creates independent unavailable destination products/toppings, not synchronized menus.

## Handle orders

The normal sequence is:

`new → preparing → ready → completed`

The Russian controls guide staff through starting preparation, marking ready and confirming collection. Any active order may be cancelled with a nonempty, customer-visible reason. Completed/cancelled orders cannot be reopened through the API.

- The queue includes all active orders, even old ones, plus up to 300 recently closed orders from the last 24 hours.
- Queue counters filter new, preparing and ready orders. Search helps find an order number or guest name.
- An order's **5 / 10 / 15 / 20 / 30 мин** shortcuts update its ETA immediately, measured from now. A custom ETA accepts 1–120 minutes.
- Settings preparation presets are different: they edit a draft and require **Сохранить настройки** (Save settings).
- Cancellation suggestions only fill the reason. Review and confirm; never put private customer details into a public cancellation message.
- Collect payment at pickup. Marking an order completed records fulfilment, not a verified cash-register transaction.

An overdue marker compares the current state/time with the estimate. Updating an ETA does not rewrite the original promised ETA used for reporting.

## Availability and intake

There are several independent reasons a store may reject new orders:

| State | Meaning | Who resolves it |
| --- | --- | --- |
| Archived | Store is retained for history but not trading | Owner |
| Unpublished | Store is a draft or hidden | Owner |
| Privacy unpublished | Business documents are not published | Owner |
| Owner stop | Business-level stop on that store | Owner |
| Operational pause | Shift temporarily stopped intake | Assigned staff or owner |
| Outside hours | Current Moscow time is outside its schedule | Wait for opening or have a manager/owner correct the schedule |

Removing one blocker does not remove the others. Workers can lift an operational pause but cannot override an owner stop. Accepted orders remain available for fulfilment while intake is stopped.

## Products and store settings

Managers/owners edit the store's menu and settings. Workers use the narrower stock and operations controls.

- Availability switches change whether a product can be ordered. Wait for success before assuming stock changed.
- Product options have stable IDs, labels and integer-ruble prices; zero can represent a free change.
- Existing receipts preserve purchased names, prices and options after edits.
- Permanent product deletion requires confirmation. Prefer availability-off for a temporary stock shortage. Deletion does not rewrite old orders or accepted retries.
- Enter confirmed ingredients/allergens only; blank is preferable to invented food-safety information.
- Opening hours are Moscow time. A closing time before opening means an overnight shift.
- Enabled scheduling with no days closes intake. Disabled scheduling leaves intake under manual pause controls.
- **Как в понедельник — на всю неделю** copies Monday into the draft, including weekends; review before saving.

## Owner workspace

Owners have four main destinations:

- **Обзор** (Overview): problems needing attention, current store queues, today's figures and recent activity.
- **Точки** (Stores): search/filter stores, open their kitchens and manage lifecycle actions.
- **Сотрудники** (Staff): accounts and complete store assignments.
- **Аналитика** (Analytics): metrics, order history and activity.

The shared **Точка** (Store) selector defaults to all stores and is preserved in navigation URLs. An account edit remains business-wide even when the list is filtered to one store.

**Персональные данные** is a secondary destination in the sidebar or mobile account menu. It applies to the entire business.

### New stores

Create a store as an unpublished draft. Configure its address, settings, products and staff before publication.

Menu copying adds new products to the destination, initially unavailable. It does not replace the destination menu or keep the two menus synchronized. Retain the same copy request key if retrying.

Archival preserves history/analytics and prevents new ordering. The server refuses archival while active orders remain.

### Reporting definitions

Reports use orders' creation dates in Moscow time. Available ranges are Today, 7 days, 30 days and custom dates bounded by the API.

Completed-order value is the sum of completed order totals; it is **not verified revenue, profit or financial reconciliation**. Timing reports use recorded events and the initial promised ETA, include sample counts and omit unavailable historical measurements. Archived aggregates are combined with retained orders without double counting.

## Accounts and password recovery

Owners create staff accounts and issue random temporary passwords shown once. They expire after 24 hours; the recipient must choose a personal password before accessing business data.

Account disabling, password resets and role/assignment changes revoke existing sessions. Personal passwords cannot be viewed. Normal sessions last up to 12 hours; temporary-password sessions are shorter and restricted. A personal password change replaces the current session and revokes the others.

For a locked-out owner on the local Compose installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\staff-admin.ps1 -Mode recovery -Username owner
```

For a hosted database, follow [direct owner administration](DEPLOYMENT.md#owner-administration). Do not point a recovery command at a database merely because its credentials happen to be in your shell.

The app protects the last active owner. Sensitive owner actions may ask for password confirmation again after five minutes.

## Backups

Start the local daily backup service without changing frontend mode:

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations up -d backups
```

It writes restricted PostgreSQL custom-format archives into ignored `backups/`, verifies their archive listing, and updates `backups/last-success`. It runs immediately and then daily, retries failures after a minute, and prunes this service's complete/incomplete dumps older than approximately 14 days before each attempt.

Take an extra backup before a migration, import or risky configuration change:

```powershell
docker compose -f compose.yaml --profile operations run --rm backups --once
```

Success means “a readable dump was made”, not “restoration was proven”. The health check becomes unhealthy when the last successful marker is older than about 25 hours.

Keep encrypted off-machine copies with a defined expiry and restricted access. A local folder does not protect against losing the computer. Provider snapshots/replicas need their own retention configuration. Protect the stable signing key and independent deletion journal separately.

### Rehearse a restore

Use a separate disposable database, not a new schema inside the live shop. These commands create no frontend/API service:

```powershell
docker compose -p shawarma-restore-check -f compose.e2e.yaml up -d db
docker compose -p shawarma-restore-check -f compose.e2e.yaml cp ./backups/CHOSEN_ARCHIVE.dump db:/tmp/check.dump
docker compose -p shawarma-restore-check -f compose.e2e.yaml exec -T db pg_restore --exit-on-error --no-owner -U shawarma -d shawarma_test /tmp/check.dump
docker compose -p shawarma-restore-check -f compose.e2e.yaml exec -T db psql -U shawarma -d shawarma_test -c "SELECT count(*) FROM orders;"
```

Replace `CHOSEN_ARCHIVE.dump` with the reviewed file. Inspect settings, receipts and migration history too. A successful count is only a basic restoration check.

A database restored from personal-data backups must remain inaccessible until the [privacy restore gate](../PRIVACY_OPERATIONS.md#restore-without-resurrecting-erased-data) has replayed the independent journal and drained overdue cleanup. This rehearsal does not authorize serving restored customer data.

After the isolated check:

```powershell
docker compose -p shawarma-restore-check -f compose.e2e.yaml down
```

Its tmpfs database is discarded. Do not change the project name to the real shop.

## Monitoring and maintenance

```powershell
docker compose -f compose.yaml -f compose.vite.yaml --profile operations ps
docker compose -f compose.yaml logs --tail 100 api backups
```

Check both `/api/health` and a real data endpoint such as `/api/stores`. Health checks PostgreSQL connectivity; it does not validate every migrated table.

The standalone server cleans expired sessions/security counters at startup and hourly. Privacy erasure and receipt archival use the separate CLI and must be explicitly activated. **Do not enable `ORDER_RETENTION_DAYS`: that old deletion path is retired.**

Arrange external uptime/backup alerts and an incident contact before launch. No external monitoring destination is configured by the source code. Serverless functions do not inherit the standalone maintenance loop or the local backup container.

Go avoids logging bearer URLs and database-error contents; nginx suppresses API URL logs. Review hosting/proxy logs separately. Never share logs containing cookies, connection URLs or private tracking tokens.

## When something fails

- **API 404 on a newly added feature:** check that the Go binary was rebuilt.
- **Health is 200 but menus/privacy return 500:** check the intended database's migration ledger and application release.
- **Login disappears on refresh:** check `/api/auth/me`, cookie delivery, HTTPS flags, origin and account revocation. A network failure is not proof that the password changed.
- **Cannot accept new orders:** inspect all intake blockers, including privacy publication.
- **Unknown/expired guest link:** customers need their original private link; numeric lookup is deliberately unavailable.

Use the [development troubleshooting table](DEVELOPMENT.md#common-development-problems) or [deployment guide](DEPLOYMENT.md#troubleshooting) for the relevant environment.
