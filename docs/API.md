# API reference

The same Go handler is used by the standalone server and Netlify adapter. Route registration in [api.go](../backend/internal/app/api.go) is the authoritative list.

All routes below include `/api`. JSON bodies require `Content-Type: application/json`. The decoder rejects unknown fields, extra JSON values and bodies over 32 KiB. Responses are JSON with `Cache-Control: no-store`.

Prices are integer rubles. Timestamps are ISO/RFC3339 values; use Moscow time for business-date reporting.

## Authentication and errors

Staff authentication uses the HttpOnly `staff_session` cookie, scoped to `/api`, SameSite=Strict and Secure on HTTPS. Send cookies with same-origin requests. Staff mutations/login require `Origin` to equal `PUBLIC_ORIGIN` exactly.

| Status | Meaning |
| --- | --- |
| 400 | Invalid payload, field or query parameter |
| 401 | Missing/expired login or invalid credentials |
| 403 | Wrong origin, insufficient role/store, temporary-password restriction or recent-password requirement |
| 404 | Missing resource/route, or no published privacy document |
| 409 | State, retry, menu, privacy-version or concurrent-edit conflict |
| 410 | Expired private receipt or unavailable expired-order content |
| 415 | Request body is not JSON |
| 429 | Throttled; respect `Retry-After` |
| 500/503 | Internal/dependency failure; do not treat an ambiguous checkout result as rejected |

Errors normally have `{"error":"Russian explanation"}`. Some 403 responses also have `code`: `reauthentication_required` or `password_change_required`.

For recent-password confirmation, POST `{"password":"…"}` to `/api/auth/reauthenticate`, then resume the original sensitive action once. Confirmation lasts five minutes. Do not generate a different action target/payload while resuming.

## Public routes

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/health` | PostgreSQL ping: `{"status":"ok"}` or unavailable |
| GET | `/api/stores` | Published, nonarchived pickup stores |
| GET | `/api/stores/{slug}/menu` | Store catalogue, settings and intake |
| GET | `/api/menu` | Legacy original-store catalogue |
| POST | `/api/orders` | Submit/retry a guest order |
| GET | `/api/orders/{token}` | Private status and receipt |
| GET | `/api/privacy` | Current published policy and consent |
| GET | `/api/privacy/versions/{id}` | An immutable published version |

A menu response includes `products`, `settings`, `store`, `accepting_orders`, `intake_message`, `estimated_minutes` and `privacy_ready`. Use server intake/estimate fields rather than recomputing them from browser time.

Store responses may contain multiple `intake_blockers`: `archived`, `unpublished`, `privacy_unpublished`, `owner_stopped`, `paused`, `outside_hours`. Do not assume lifting one clears all others.

### Checkout

Example for a number-only order; replace product/price/document IDs with the values actually displayed:

```json
{
  "store_id": 1,
  "name": "",
  "note": "",
  "request_key": "11111111-1111-4111-8111-111111111111",
  "items": [
    {"product_id": 1, "quantity": 2, "expected_price": 290, "options": []}
  ],
  "privacy": {"notice_version": 1, "consent_version": 0, "accepted": false}
}
```

`expected_price` is the unit price including selected extras. Go recomputes totals from current product data before acceptance.

| Field/constraint | Rule |
| --- | --- |
| `store_id` | Positive target ID; omission/zero is legacy original store 1 |
| `name` | Optional; trimmed; at most 60 Unicode characters |
| `note` | Optional; trimmed; at most 500 Unicode characters |
| `request_key` | 32–80 ASCII letters/digits/hyphens |
| Basket | 1–30 distinct variant lines, up to 20 units each, 50 total units |
| Selected options | At most 12 unique IDs per line; known product options only |
| Optional fields | Any entered name/note requires accepted separate consent for the current displayed version |

Current clients must submit `privacy.notice_version`. If optional fields are entered, set `accepted=true` and `consent_version` to the published version accepted by the customer. Never check consent automatically.

**Freeze the entire submitted payload**, including store, prices, options and privacy versions, alongside its request key. After response loss, network errors or 429, retry that exact attempt.

An accepted identical attempt is returned before today's intake, prices or policy are checked. Different content or another store with the same key conflicts. An expired replay marker must not create another order. Legacy accepted fingerprints remain supported; a new outdated client must refresh.

Checkout/product edits serialize on the store row. Orders retain purchased product/option names/prices and the pickup-location snapshot.

### Private links

The frontend link is `/track#TOKEN`; only the API request includes the bearer token in its path. The token is derived with the stable server key and only its hash is stored. Order numbers alone cannot retrieve receipts.

Tracking excludes customer name/note, internal ID and bearer token. Staff responses may contain personal fields unless blocked/erased. Do not log bearer URLs or put private links in screenshots/support reports.

After receipt expiry, tracking returns 410 and browser history can retain an honest expired entry. Clearing browser storage removes saved links; there is no customer account lookup.

## Staff authentication

| Method | Route | Body/purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | `{"username":"anna","password":"…"}` |
| GET | `/api/auth/me` | Identity, owner flag, account status and memberships |
| POST | `/api/auth/logout` | Revoke current session |
| POST | `/api/auth/change-password` | `{"current_password":"…","password":"…"}` |
| POST | `/api/auth/reauthenticate` | Confirm current password for sensitive actions |

Login limits apply to both client identity and username. Unknown, disabled and incorrect-password accounts share a public error. Normal sessions last 12 hours. Temporary-password sessions are restricted and shorter; the temporary password expires after 24 hours.

Personal passwords allow 15–128 characters and use Argon2id. Imported bcrypt hashes remain verifiable until replaced. Password/access changes revoke existing sessions. Personal password change issues a replacement current session.

## Store-scoped staff routes

Prefix: `/api/staff/stores/{storeId}`.

“Staff” below means an assigned worker/manager or an owner. Management means manager at that store or owner.

| Method | Suffix | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/menu` | Staff | Store catalogue/settings |
| GET | `/orders` | Staff | Active queue + up to 300 recently closed orders |
| PATCH | `/orders/{id}` | Staff | Status/ETA/cancellation |
| PATCH | `/operations` | Staff | Narrow shift controls |
| PATCH | `/products/{id}/availability` | Staff | Availability only |
| POST | `/products` | Management | Create product |
| PUT | `/products/{id}` | Management | Replace editable product fields |
| DELETE | `/products/{id}` | Management | Permanent removal, preserving receipts |
| PUT | `/settings` | Management | Replace editable settings |
| GET | `/history` | Management | Paginated full retained history |
| GET | `/analytics` | Management | Store report |
| GET | `/activity` | Management | Store activity |

`GET /api/staff/stores` lists stores available to the current account. Resource IDs are always constrained by the authorized path store. Query parameters cannot override staff scope. Archived stores remain readable where authorized; store mutations are refused.

### Order and operational payloads

```json
{"status":"preparing","eta_minutes":15}
```

Fields are optional. ETA is 1–120 minutes from now. Valid transitions are `new → preparing → ready → completed`; active orders may become `cancelled`. Repeating a status does not create a transition. Terminal orders cannot reopen.

Cancellation requires `{"status":"cancelled","cancellation_reason":"Reason shown to the guest"}`; the reason must be nonempty and no longer than 300 characters.

Operational PATCH fields: `paused`, `prep_minutes`, `reason`. A pause needs a reason. Availability PATCH is `{"available":false}`. Unknown/restricted fields are rejected; workers cannot use these requests to edit prices or owner stops.

### Products and settings

Products use `name`, `description`, `price`, `image`, `weight`, `category`, `available`, `sort_order`, `ingredients`, `allergens`, `options`.

An option is `{"id":"extra-cheese","label":"Дополнительный сыр","price":50}`. Preserve stable IDs when changing text/prices. Images accept local `/images/…` or HTTPS paths. Unknown composition fields may stay empty.

Settings use `paused`, `prep_minutes`, `pause_message`, `shop_name`, `address`, `city`, `phone`, `hours_note`, `map_url`, `schedule_enabled`, `demo_mode` and `opening_hours`.

An hours entry is `{"day":1,"open":"09:00","close":"22:00"}`: Sunday=0, Saturday=6, Moscow time, one entry per day. Equal open/close is invalid; earlier closing means overnight. Enabled empty hours close intake; disabled scheduling leaves manual controls.

PUT clients should preserve fields they are not intentionally changing.

## Owner routes

All require an owner session. **R** additionally requires recent password confirmation.

| Method | Route | R | Purpose |
| --- | --- | --- | --- |
| GET | `/api/owner/stores` | | Store states/counts |
| POST | `/api/owner/stores` | Yes | Create unpublished store |
| PATCH | `/api/owner/stores/{id}` | Yes | Publish/archive/owner stop |
| GET | `/api/owner/users` | | All accounts |
| POST | `/api/owner/users` | Yes | Create account and temporary password |
| PUT | `/api/owner/users/{id}` | Yes | Update account/access |
| POST | `/api/owner/users/{id}/reset-password` | Yes | Issue replacement temporary password |
| POST | `/api/owner/menu-copy` | Yes | Retry-safe independent menu copy |
| GET | `/api/owner/orders` | | Retained order history |
| GET | `/api/owner/analytics` | | Combined/store report |
| GET | `/api/owner/activity` | | Business/store activity |

Store creation: `slug`, `name`, `address`. Lifecycle PATCH: optional `published`, `archived`, `owner_stopped`, `reason`. Archival conflicts while active orders remain.

Account input: `username`, `display_name`, optional `phone`/`email`, `owner`, `active`, and the complete `memberships` array of `{"store_id":1,"role":"worker"}`. Send every assignment, including ones hidden by a UI filter. Creation/reset returns a one-time `temporary_password`; existing passwords are never returned. Resetting one's own password uses the personal-password endpoint instead.

Menu copy: `source_store_id`, `destination_store_id`, `product_ids`, `request_key`. Copies create new unavailable products and do not synchronize menus.

### Reporting queries

Owner reports/history/activity accept positive `store_id`; omit it for all stores. Invalid values are 400, unknown stores 404. Filtering precedes pagination.

History/activity use a positive `before` cursor, newest first, up to 100 records. History also accepts `status`.

Analytics accepts inclusive `from`/`to` dates in `YYYY-MM-DD`, defaulting to the last seven Moscow dates; the allowed start/end distance is at most 365 days. Metrics group orders by creation date. Values and timing sums/sample counts combine retained orders with archived aggregates. Missing historical timings are not invented.

## Privacy administration

Owner-only, with recent password confirmation where marked.

| Method | Route | R | Purpose |
| --- | --- | --- | --- |
| GET | `/api/owner/privacy` | | Draft, published version and previews |
| PUT | `/api/owner/privacy/draft` | Yes | Save `{revision,draft}` |
| POST | `/api/owner/privacy/publish` | Yes | Publish saved `{revision}` |
| GET | `/api/owner/privacy/retention` | | Preview/activation state |
| POST | `/api/owner/privacy/retention` | Yes | `{enabled,previewed}`; explicit activation |
| GET/POST | `/api/owner/privacy/requests` | Yes | List/create rights cases |
| POST | `/api/owner/privacy/requests/{id}` | Yes | Verified case action |
| GET | `/api/owner/privacy/destructions` | Yes | Paginated destruction-log extract |

Operator fields: `kind` (`company`/`ip`), `legal_name`, `inn`, `registration`, `address`, `contact` (email), `contractors`, `locations`, `staff_basis`, `approved`. Publishing validates completeness and the saved revision. Editing does not change immutable published versions.

Create a case with `store_id`, exactly one of `order_id`/`order_number`, and `kind`: `access`, `correction`, `withdrawal`, `erasure`, `dispute`.

Actions are `verify`, `export`, `block`, `correct`, `erase`, `resolve`. Verification accepts `personal_link_and_purchase`, `in_person` or `existing_contact`. Other actions require a verified case. Correction supplies `name`/`note` and cannot restore an erased/expired purpose. Request listing uses `before` with up to 200 entries. Destruction listing uses `after` event IDs and returns its next cursor.

These endpoints do not verify identity automatically, send correspondence, install a scheduler or sign statutory acts. See [privacy operations](../PRIVACY_OPERATIONS.md).

## Legacy compatibility

`/api/kitchen/login`, `logout` and `session` alias current authentication. Kitchen order/product/settings aliases remain anchored to original store 1 and enforce current permissions, including DELETE.

Legacy public checkout/menu requests stay anchored to store 1. Compatibility is not an authorization bypass. New integrations should use the current store-aware routes.
