# Interface and design principles

## Direction

The user asked for a familiar Russian food-ordering experience, referencing Rostic's, Yandex Go / Yandex Eats, and Вкусно — и точка, with typography similar to Wildberries careers. Treat these as interaction and hierarchy references: food comes first, prices are clear, the basket is easy to reach, and checkout makes the fulfilment method obvious. Keep this shop's own name, content, and colours. Do not copy reference brands' logos, promotional offers, photos, or proprietary design assets. The user's separately supplied shop-menu listing is the authorized source for the actual food photos/prices.

This is a **pickup app for stores within one business**. Do not add delivery switches, fake discounts, loyalty points, nutrition figures, or payment methods that the backend/shop does not support. Online payment is not available. The original store catalogue uses 19 real listing items, prices, portion sizes, and photos from the user-selected Yandex Maps source, checked on 2026-10-10. See [menu provenance and import](MENU_SOURCE.md).

## Typography and visual system

- **Inter Variable**, served from `/fonts/InterVariable.woff2`. The [current RWB careers stylesheet](https://career.rwb.ru/assets/index-BGs2E8uH.css) declares Inter 24pt Regular/Medium/SemiBold/Bold. Our independently distributed open-source Inter uses optical size 24. License and provenance are in `public/fonts/`. The old CSS named Inter without loading it; avoid returning to a system-font-only implementation.
- Regular/medium body and control text, restrained semibold titles, tabular digits for quantities/times/totals. Avoid making every title or label extra-bold.
- White surfaces on pale neutral grey `#f5f5f7`, dark text `#222224`, warm red-orange action colour `#d63a1d`. A warm yellow pickup banner adds personality without a large marketing hero. Status colours communicate state alongside words/icons.
- Use 8px-based spacing where practical, 12–20px surface radii, subtle dividers, and minimal shadows. Cards should look like a food catalogue, rather than a landing page or a collection of decorative dashboard tiles.
- Keep titles short and direct: «Меню», «Оформление заказа», «Кухня». Avoid oversized slogans, upper-case eyebrow text on every section, decorative badges, and excessive negative letter spacing.
- Images retain their real aspect/crop and open details. Product names stay readable; descriptions may clamp to two lines on catalogue cards, with full text in details. Ingredient/allergen information is never fabricated.
- Food images are locally hosted Yandex XXL variants, approximately 61–265 KiB each. Keep the source URL and SHA-256 in `config/menu.json`; do not substitute stock/generated photos or rely on runtime Yandex hotlinks. Present the listed ruble price and portion size without fabricated discounts or inferred ingredient descriptions. Light name/case normalization is recorded alongside the original source names.
- The pickup banner uses a current catalogue photo too; do not leave demonstration imagery in prominent shared surfaces after replacing the menu. Search appears for larger catalogues, with a separate icon gutter so its text/native clear control remain readable on phones and desktop.

## Customer flow

1. A compact shop header shows the name and pickup-address dropdown on phones and desktop. Open the last selected published store by default, otherwise the first; stable store links open their own menu. Switching points preserves each store's basket and pending submission independently. Current intake state and preparation estimate appear above the catalogue. Categories and food appear near the top. Desktop uses three food cards plus a sticky basket; phones use two cards per row.
2. Clicking a product photo/name opens a labelled native dialog: image, weight, description, optional independent extras, expandable ingredients/allergens, quantity, and an exact add-to-basket total. Phones use a sheet with a reachable sticky action row; desktop uses a two-column dialog. Escape restores focus to the opener.
3. Quick card additions select the base product. Product details are where customers choose extras. Quantities of different option combinations remain independent. A one-item card becomes a stepper; the whole order still respects 20 items per variant, 50 items total, and 30 distinct lines.
4. On desktop, the basket stays beside the menu. On phones/tablets, a bottom bar shows count/total and opens the basket sheet. Every basket line can be decreased or removed when intake closes or a product becomes unavailable.
5. Checkout separates **Получение**, **Ваши данные**, and **Оплата**. Pickup and payment at collection are clearly selected. Guest name and comment are optional. A visible receipt allows review and quantity changes; desktop submission is in the summary, mobile submission stays at the bottom.
6. Submitting freezes the exact order. Preserve the same payload/request key through timeout, response loss, 429, and reload. Pending attempts cannot be edited and must not become a new order just because the interface has changed. Definite validation/conflict responses allow correction.

7. **Мои заказы** is a separate `/orders` page showing every order still saved in this browser, newest first. The catalogue only includes a compact shortcut/count, even with a large history. Keep the shortcut available when history is empty; the history page then offers a clear menu action. Direct URLs/reloads work, old `/#orders` anchors redirect here, and tracking provides “Все мои заказы”. Recover missing metadata on this page rather than fetching old orders just to render the home count. Each link uses its actual order number and Moscow date/time (including the year). Recover missing numbers/dates from legacy token-only entries through their private endpoint; use «Заказ по личной ссылке» if recovery is unavailable. Never call an arbitrary unnumbered entry «Последний заказ». Successful tracking visits also save the link, without promoting an old order above newer orders. Keep the browser/device scope explicit; this is not an account or a list of other customers' orders.

Keep private tracking, complete local order history, server-calculated prices, historic receipts, and Moscow timestamps intact during visual changes. Never discard history because a request fails, cap it at five entries, or attach a previous tracking response to a different private link. Clearing browser storage removes saved links; orders already discarded by the old cap require their original personal link to be restored.

## Kitchen on a phone

- Mobile bottom navigation has three stable destinations: **Заказы**, **Меню**, **Настройки**. Desktop uses ordinary tabs. The active destination has both visual and accessible state; fixed controls reserve space for safe areas and content.
- Orders are one column on phones, two on tablets, three on desktop. Guest names, item options/notes, current status, ready time, and total precede actions. New-order notices and overdue markers remain visible.
- Preparation shortcuts **5 / 10 / 15 / 20 / 30 мин** on an order apply immediately, using the same validated API as manual entry. Disable controls during the request and announce success/error. The separate custom input accepts 1–120 minutes and requires «Применить».
- Settings preparation presets only change the draft. Staff must choose **Сохранить настройки** to persist the whole form. Never silently save other dirty fields when a shortcut is clicked.
- Queue counters for new/preparing/ready orders act as filters. Cancellation reason suggestions prefill the input; they never cancel without the explicit confirmation action.
- Menu availability is a labelled switch for each product, avoiding opening a full editor for a stock change. Fetch current product fields before sending the full-object PUT. A failed request must not display an optimistic success.
- Opening hours remain per-day editable; «Как в понедельник — на всю неделю» copies the Monday shift into the draft. Disabled scheduling and overnight hours retain their existing semantics. Copying does not auto-save.
- Show unsaved settings state and keep the save action reachable above mobile navigation. Product options, day/time fields, and editor action rows must fit at 320px.

## Owner workspace

Keep the owner workspace distinct from the shift kitchen. Its four primary destinations are URL-backed **Обзор, Точки, Сотрудники, Аналитика**; privacy is a secondary business-wide destination. Use the 232px desktop sidebar from 1024px and four fixed bottom destinations below it. Reserve safe-area space. The header's store selector carries `store_id` through navigation; filters and report views live in URLs, not browser storage.

Lead the overview with actionable intake blockers and overdue queues, then current store rows, today's Moscow-date cohort and five recent cancellations/actions. Scheduled closure is informational. Show server-provided `intake_blockers`, including overlapping reasons; lifting an owner stop does not resolve other blockers. Never call completed-order value verified revenue or profit.

Use compact desktop rows, stacked phone cards, restrained type and neutral action menus. Store search/archive filters and staff search/access/role filters remain visible. Account editors always expose complete business-wide assignments, even when their list was filtered. Confirm destructive access changes, preserve drafts through errors/reauthentication, and warn before leaving unsaved edits. Privacy separates documents, verified requests and retention; publication and cleanup remain explicit protected actions.

Reports retain real timing sample counts, labelled axes/units, zero-order days and an accessible data table. Scope changes clear old data immediately and cancel requests; same-scope refresh errors may retain results only with a stale-data timestamp. Do not disguise failed requests as zero or rely on colour alone.

## Accessibility and verification

Use native buttons, labels, checkboxes, forms, switches, and dialogs. Preserve visible focus, 44px primary touch targets, 16px text inputs, semantic grouping, reduced-motion support, safe-area padding, and labelled live messages. Icons supplement text rather than replacing ambiguous actions. Do not allow decorative status dots to carry the only meaning.

Validate storefront, product details, checkout, kitchen queue, settings, and option editor at **320, 390, 768, and 1440px**. Check actual screenshots as well as scroll-width assertions. Test the font loading with Cyrillic/ruble text, immediate ETA persistence, draft-only settings presets, quick availability changes, product quantities/options, and the existing lost-response retry flow. Use the isolated browser-test stack, never real shop orders.

See `tests/e2e/design.spec.ts`, `tests/e2e/improvements.spec.ts`, `tests/e2e/order.spec.ts`, `tests/e2e/history.spec.ts`, and `docs/TEST_RESULTS.md`. History regressions use synthetic private links and mocked tracking receipts. Chromium checks do not replace a real-device iOS/Safari check or a full accessibility audit.
