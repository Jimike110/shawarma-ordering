# Interface and interaction design

The application should feel familiar to Russian pickup-food customers and practical for staff working a shift. Ordering references include Rostic's, Yandex Go/Yandex Eats and Вкусно — и точка. Use their clarity and interaction patterns as inspiration, not their branding or proprietary assets.

The product is pickup ordering for stores within one business. Design must not imply delivery, online payment, loyalty, AI, push alerts or other absent functionality.

## Visual language

- Load the bundled **Inter Variable** font from `/fonts/InterVariable.woff2`, including Cyrillic. A CSS family name without the font asset is insufficient. Provenance/license: [font credits](../public/fonts/CREDITS.md).
- Use regular/medium body text and restrained semibold headings. Use tabular numbers for times, quantities and money.
- White surfaces, pale grey backgrounds, dark text, subtle dividers and restrained red-orange primary actions.
- Keep catalogue quantity controls neutral; reserve prominent colour for meaningful actions.
- Use compact layouts and readable product photographs, not oversized marketing heroes or decorative dashboard metric tiles.
- Pair status colours with text/icons. Avoid conveying availability or overdue state by colour alone.
- Keep Russian UI labels direct; use rubles and Moscow dates/times consistently.

The font choice was inspired by the supplied Wildberries/RWB careers reference. The bundled font is independently licensed Inter, not a copied proprietary brand font.

## Content accuracy

Use locally hosted shop photos whose sources/checksums are recorded in [the menu manifest](../config/menu.json). Do not replace them with generated food, stock photography or runtime Yandex hotlinks.

Prices/photos/portions are a dated import, not a live integration. Current database edits override setup assumptions. Never invent promotions, ingredients, allergens, nutrition, phone numbers or guaranteed preparation times.

Unknown composition/allergen information should be visibly unconfirmed, not inferred from a product name or photo.

## Customer ordering

### Catalogue and store selection

The header contains the pickup-address dropdown. The root route opens the last available selection or a published fallback; stable `/s/:slug` links identify a store.

Keep the selected address prominent through catalogue, basket and checkout. Switching stores preserves separate baskets without transferring products. Clear stale store data and abort obsolete requests.

Food cards use two columns on phones. Desktop can show a larger grid with a sticky basket. Search and category navigation must remain easy to reach for longer menus.

### Product details and basket

Product details show the image, portion, price, optional extras, quantity and exact total. Expandable composition must not hide important uncertainty. Use a labelled dialog/sheet, reachable primary action, Escape handling and focus restoration.

Variants are identified by product plus selected option IDs. Different variants have independent quantities. Limits match the API: 20 units per variant, 50 total units, 30 lines.

The mobile basket opens from a fixed summary bar; desktop uses a visible summary. Leave safe-area/content padding so fixed controls never cover actions. Customers can reduce/remove items while intake is stopped.

### Checkout and consent

Group checkout into pickup, optional customer information and payment at collection. Guest name/comment are optional. Consent is separate, initially unchecked and unnecessary for number-only collection.

If text needs consent, explain the missing action; do not silently discard it. Warn against health/payment/other people's personal information in preparation comments. Link policy/consent at collection points and in the footer.

Submitting freezes the exact payload, store, document versions and retry key. Visual work must not alter retry behaviour after ambiguous failures.

### Tracking and history

Tracking uses a private link, shows actual statuses, the current estimate, pickup location and honest late/cancelled/completed states. A number alone never opens a receipt.

`/orders` is the dedicated browser-history page. The catalogue shows only its shortcut/count, not an expanding list. Preserve every valid saved link, unavailable/expired entries and complete legacy-history migration. Never reintroduce a five-link limit.

Current customer tracking has **no sound or vibration**. Background push/SMS is not implemented. Do not add notification promises to screenshots or copy.

## Kitchen

Phones have three stable bottom destinations: Orders, Menu and Settings. Reserve bottom/safe-area padding. Larger screens use ordinary navigation and compact queue columns.

Orders show status, number, purchased items, permitted personal fields, ETA and total before actions. Queue counters filter status, and overdue/new-order notices remain visible.

| Interaction | Behaviour |
| --- | --- |
| Order ETA presets | Save immediately and announce success/error |
| Custom ETA | Explicit apply, 1–120 minutes |
| Settings presets/schedule copy | Change draft only; explicit save |
| Availability | Show changed stock only after API success |
| Cancellation suggestion | Prefill reason only; explicit cancel confirmation |
| Product deletion | Management permission, explicit destructive confirmation |
| Pause/resume | Narrow operational update; cannot override owner stop |

Kitchen sound defaults on per visit. Distinguish active, muted and browser-blocked/loading states. Retain pending alerts until activation/loading succeeds, while respecting deliberate mute. Audio is an enhancement to an open queue, not guaranteed background delivery.

## Owner workspace

Main destinations remain **Обзор, Точки, Сотрудники, Аналитика**. Privacy is secondary, business-wide administration.

Use the shared layout: 232px sidebar at 1024px and above; four fixed bottom destinations below. The mobile labelled account menu contains privacy, password change and logout.

Routes and `store_id` selection must survive direct links, refresh and Back/Forward. Invalid selections return to all stores with an explanation. Store filtering never silently limits a business-wide account edit.

Overview order:

1. Actionable intake/privacy/overdue issues.
2. Live store queues and kitchen links.
3. Today's Moscow-date figures.
4. Five recent cancellations and five recent activity entries.

Show all relevant blockers; an ordinary scheduled closure is informational. Lifting an owner stop must not imply that a pause or missing privacy publication disappeared.

Store/staff screens use compact desktop rows and readable phone cards. Keep search/filter controls, explicit saves, confirmations and full assignments. New stores start unpublished; menu copying names source/destination and retains the same retry key.

Analytics separates metrics, order history and activity through URL-backed views. Label dates, units, axes, sample counts and missing timing data. Include zero-order days and an accessible table. Never label completed-order value as verified revenue.

Privacy separates documents, requests and retention. Distinguish unsaved edits, saved draft and immutable published versions. Keep verification, reauthentication and cleanup activation explicit.

## Accessibility and failure handling

Use native labelled controls/dialogs, visible focus, at least 44px primary touch targets, readable text inputs and safe-area spacing. Icons supplement text.

On a scope/account change, cancel obsolete requests and hide mismatched data immediately. A same-scope refresh failure may retain results only with an explicit stale state/timestamp; it must not appear as zero.

Keep form drafts through errors and password confirmation. Warn before abandoning edits. Resume a sensitive action once with its original target/payload.

Route/root error recovery must work without auth/menu providers and must never expose raw stack traces, clear browser storage or resubmit an order.

## Review checklist

Inspect at 320, 390, 768 and 1440px, including real screenshots:

- No horizontal overflow or content hidden behind fixed navigation.
- Cyrillic/ruble font loading and readable product names/prices.
- Keyboard access, dialog focus restoration and labelled errors.
- Checkout submission/retry state and independent store baskets.
- Immediate order controls versus unsaved settings drafts.
- Owner filters, account memberships, report labels and privacy safeguards.

Chromium screenshots do not establish physical-phone Safari behaviour or a complete accessibility audit. See the [testing guide](TEST_RESULTS.md).
