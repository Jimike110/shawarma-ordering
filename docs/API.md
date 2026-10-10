# API

All routes use `/api`. JSON requests require `Content-Type: application/json`. Responses use `Cache-Control: no-store`. Monetary values are integer rubles; payment is at pickup. Error bodies are `{ "error": "Customer-readable message" }`.

| Method and route           | Access                    | Purpose                                          |
| -------------------------- | ------------------------- | ------------------------------------------------ |
| GET /health                | Public                    | Database-aware health                            |
| GET /menu                  | Public                    | Products, settings, intake state and estimate    |
| POST /orders               | Public, rate-limited      | Transactional checkout                           |
| GET /orders/{token}        | Private bearer link       | Status, receipt, total, ETA, cancellation reason |
| POST /kitchen/login        | Credentials, rate-limited | Start session                                    |
| POST /kitchen/logout       | Staff                     | End session                                      |
| GET /kitchen/session       | Staff                     | Check session                                    |
| GET /kitchen/orders        | Staff                     | All active plus recent closed orders             |
| PATCH /kitchen/orders/{id} | Staff                     | Status, ETA, cancellation                        |
| POST /kitchen/products     | Staff                     | Add product                                      |
| PUT /kitchen/products/{id} | Staff                     | Replace editable product fields                  |
| PUT /kitchen/settings      | Staff                     | Replace shop and intake settings                 |

## Menu and products

`GET /menu` returns `products`, `settings`, `accepting_orders`, `intake_message`, and `estimated_minutes`. The server evaluates the opening schedule and manual pause, and estimates preparation time from the configured base and active queue, capped at 120 minutes. Use the server intake fields rather than independently interpreting local browser time.

Product fields: `id`, `name`, `description`, `price`, `image`, `weight`, `category`, `available`, `sort_order`, `ingredients`, `allergens`, and `options`. An option is `{ "id": "extra-cheese", "label": "Дополнительный сыр", "price": 50 }`. Up to 12 independent options may be selected; price zero represents a free change. Preserve stable option IDs when editing labels/prices. Images accept `/images/...` paths or HTTPS URLs.

Ingredient/allergen strings may be empty when unknown. The frontend explicitly states that the information needs confirmation. Do not infer food safety information from photos or product names.

## Checkout and private tracking

```json
{
  "name": "Михаил",
  "note": "Позвоню при получении",
  "request_key": "11111111-1111-4111-8111-111111111111",
  "items": [{ "product_id": 1, "quantity": 2, "expected_price": 340, "options": ["extra-cheese"] }]
}
```

`expected_price` is the unit price including extras. The server calculates totals from the database. Different option combinations are separate lines. Limits: 20 items per variant, 50 total, 30 distinct lines, name 1–60 characters, note up to 500 characters. Duplicate variants or option IDs are rejected. A request key is 32–80 alphanumeric/hyphen characters.

Freeze the submitted payload and reuse its exact request key after an ambiguous result. Identical retries return the existing order, including after intake closes or prices change. Reusing a key with different content returns 409. Preserve pending attempts after network errors and 429; a new key can produce a duplicate order. A 409 also indicates stale prices, unavailable products/options, or closed intake; refresh menu state before another order.

Checkout and product edits lock the shared settings row, making pause, availability, and price checks atomic. Order items retain purchased names, unit prices, and option labels/prices after staff edits.

A private token is a 256-bit HMAC derived from the request key and server secret; only its SHA-256 hash is stored. Checkout returns the token. Tracking uses `/track#TOKEN`; its API request uses `/api/orders/TOKEN`. Public tracking excludes customer name/note, internal ID, and token. Sequential order numbers cannot retrieve orders. Do not log bearer URLs or expose private links in screenshots/reports. The nginx API location suppresses URL access/error logs.

## Staff authentication and orders

Login body is `{ "password": "..." }` for shared access or `{ "username": "anna", "password": "..." }` when `STAFF_USERS` is configured. Named accounts use bcrypt hashes; all have kitchen access. Removing/changing credentials invalidates previous named sessions when the configuration takes effect. Mutations record the staff identity transactionally in `audit_events`.

Opaque 256-bit session tokens use hashed database storage and 12-hour expiry. Cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS. Staff mutations require an Origin matching `PUBLIC_ORIGIN`. Authentication/order limits persist across processes. For the private Docker API only, `TRUST_PROXY=true` trusts `X-Real-IP`, overwritten by nginx. Do not expose that API port directly. The Netlify adapter uses the provider's client IP.

The kitchen list contains every active order, regardless of age, plus up to 300 orders completed/cancelled within the last 24 hours. Staff responses include internal IDs, names, and notes.

```json
{ "status": "preparing", "eta_minutes": 22 }
```

Both fields are optional. ETA is 1–120 minutes from update time. Transitions follow `new → preparing → ready → completed`; an active order may become `cancelled`. Terminal orders cannot reopen. Conflicts return 409 and require a refresh.

Cancellation body:

```json
{ "status": "cancelled", "cancellation_reason": "Сегодня закончился сыр." }
```

The reason is customer-visible, up to 300 characters, and only accepted with cancellation. The kitchen UI requires a reason; the API permits an empty reason for compatibility.

## Shop settings

Send the complete settings object on PUT, preserving fields you are not changing:

```json
{
  "paused": false,
  "prep_minutes": 15,
  "pause_message": "",
  "shop_name": "Я люблю шаверму",
  "address": "Белорусская ул., 4",
  "city": "Санкт-Петербург",
  "phone": "",
  "hours_note": "",
  "map_url": "",
  "schedule_enabled": true,
  "demo_mode": true,
  "opening_hours": [{ "day": 1, "open": "09:00", "close": "22:00" }]
}
```

`day` is 0 Sunday through 6 Saturday. Times use Moscow time and `HH:mm`. Each day appears at most once; equal opening/closing times are invalid. Closing earlier than opening represents an overnight shift ending the next day. Manual pause overrides the schedule. Disabled scheduling means manual intake; enabled scheduling with an empty list closes intake. The example contains Monday only; `config/shop.json` contains the confirmed daily schedule. Map links require HTTPS. Keep `demo_mode` true until actual products/prices/photos have been confirmed.
