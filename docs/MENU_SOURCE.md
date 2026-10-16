# Menu source, import and transfer

The repository contains a reviewed initial catalogue; the running database contains the shop's current menu. They are different sources with different purposes.

## Bundled shop snapshot

| Fact | Value |
| --- | --- |
| Snapshot date | 10 October 2026 |
| Listing | [Yandex Maps organization 223602659821](https://yandex.ru/maps/org/ya_lyublyu_shavermu/223602659821/menu/) |
| Listing brand/address | Я@Ша, Белорусская ул., 4, Санкт-Петербург |
| Manifest | [config/menu.json](../config/menu.json) |
| Products | 19: 11 shawarma, 2 soups, 6 other fast-food items |
| Photographs | Local JPEG files under `public/images/menu/` |
| Pricing | Dated integer-ruble snapshot; no live Yandex synchronization |

The bundled [shop configuration](../config/shop.json) retains the initial name Я люблю шаверму and daily 09:00–22:00. Staff may have changed the brand, hours, phone or stock; **do not overwrite current database settings from these notes**.

Full ingredient/allergen descriptions and priced extras were not supplied by the listing. Keep unknown fields empty until the shop confirms them. “Веган” is a source product name, not an independent certification.

Photo URLs, exact checksums, portions and original/display names are recorded in the manifest. [Photo credits](../public/images/CREDITS.md) preserve provenance and rights information. The photos are not claimed to be CC0.

## Choose the right operation

For the trial, the owner-supplied current menu determines prices/portions; [this supplied Yandex Eats listing](https://eda.yandex.ru/r/a_sa_restaurant?placeSlug=shaverma_8c72f) is the proposed composition/photo/additive reference. It is not automatically imported or an approval of price differences. Compare exact identities and discrepancies in an ignored review artifact before applying anything; preserve confirmed product/legacy option IDs and all historical receipts. Yandex may require a browser/CAPTCHA, so unavailable fields stay unknown. Use the canonical topping editor for explicit dish assignments and separate extra/standalone prices; do not silently convert old options by matching names.

The dated snapshot helper refuses matches against canonical standalone topping offers, so it cannot silently overwrite their independent catalogue fields. Upgrade the schema before using current import tooling. It is not an importer for the new owner menu.

| Need | Tool | Source/target behaviour |
| --- | --- | --- |
| Initial 19-item catalogue | `prepare-menu-import.mjs` | Manifest → reviewed SQL for explicit `STORE_ID` |
| Copy current original-store public data to a new environment | `prepare-shop-transfer.mjs` | Local legacy `/api/menu` → snapshot + SQL for explicit target `STORE_ID` |
| Ongoing edits | Kitchen Menu/Settings | Edit the actual selected store directly |
| Copy a menu within the business | Owner menu-copy action | Adds new unavailable products; no synchronization |
| Restore orders/accounts and all database data | Backup/restore procedure | Not a catalogue import |

Neither preparation script writes to a database. Running its generated SQL does.

## Import the bundled catalogue

Start/configure the app first. Choose the intended store ID explicitly. The example targets original store 1. Back up before changing an existing database.

From the root:

```powershell
docker compose -f compose.yaml --profile operations run --rm backups --once
docker compose -f compose.yaml -f compose.tools.yaml run --rm --no-deps -e STORE_ID=1 frontend-tools node scripts/prepare-menu-import.mjs
```

This verifies all local photo checksums and writes ignored `artifacts/import-menu.sql`. Review the SQL and manifest before applying:

```powershell
docker compose -f compose.yaml cp artifacts/import-menu.sql db:/tmp/import-menu.sql
docker compose -f compose.yaml exec -T db psql -v ON_ERROR_STOP=1 -U shawarma -d shawarma -f /tmp/import-menu.sql
docker compose -f compose.yaml --profile operations run --rm backups --once
```

In Vite mode, included public assets are served directly. With nginx, rebuild the frontend if the deployed image does not yet include those assets. Do not drop the Vite override from a start/rebuild command accidentally.

### What the import changes

- Matches earlier imports by local image path and retains matching product IDs.
- Updates manifest-owned names, prices, portions, categories and ordering.
- Preserves existing availability, descriptions, ingredients/allergens and options.
- Adds missing products with new IDs.
- Removes only the three completely untouched bootstrap demo fixtures.
- Turns demo mode off, records the source map link and an import activity event.
- Preserves other settings, unrelated products and historical receipts.

Duplicate matches abort the transaction. Changing image paths changes matching semantics; review such a change rather than treating import as continuous synchronization.

`--download-photos` is an optional refresh from recorded CDN URLs. It refuses changed checksums; review changed source material before accepting it. Ordinary setup already has the bundled assets and needs no download.

Do not modify applied migrations to seed a running shop.

## Transfer current public settings and menu

Use this for a fresh, migrated target that should receive current original-store public content without local orders, credentials or sessions.

```powershell
docker compose -f compose.yaml -f compose.tools.yaml run --rm --no-deps -e STORE_ID=1 frontend-tools node scripts/prepare-shop-transfer.mjs
```

The tools service uses `LOCAL_API_URL=http://web`. The script accepts only local HTTP origins and reads legacy `/api/menu`, which is anchored to **source store 1**. Here `STORE_ID` selects the generated SQL's target store; it is not a source-store selector.

Outputs:

- `artifacts/shop-transfer.json`: reviewable public snapshot.
- `artifacts/import-shop.sql`: transactional SQL suitable for a PostgreSQL/Neon SQL editor.

Review actual name, hours, stock, phone, prices/options and photos. Back up the intended target. Apply migrations there first, then run the reviewed SQL against that exact database.

The transfer preserves unrelated products/receipts, matches images, refuses conflicting target staff edits and can reapply an identical snapshot without changing IDs. It is a one-time initial-data operation, not ongoing synchronization. Future edits belong in the target kitchen.

A valid public transfer does not approve a provider for Russian real-data production; see [deployment](DEPLOYMENT.md).

## Original shop settings helper

Prefer Kitchen → Settings. `scripts/configure-shop.mjs` is a local-only fallback requiring explicit `STORE_ID`, `STAFF_USERNAME` and `STAFF_PASSWORD`. It loads `config/shop.json`, authenticates, updates the selected store and logs out.

That helper can overwrite current staff values with the original brand/hours. Do not run it automatically after importing or upgrading.

## Dated reference catalogue

Current prices/stock must be confirmed in the database and with the shop.

| Product | Portion | Snapshot price |
| --- | --- | ---: |
| Шаверма в пите | 360 г | 280 ₽ |
| Шаверма в лаваше | 420 г | 330 ₽ |
| Веган | 400 г | 220 ₽ |
| Шаверма с маринованной капустой | 430 г | 330 ₽ |
| Рыба-Фиш | 400 г | 350 ₽ |
| Шавер-Дог | 400 г | 300 ₽ |
| Шаверма по-деревенски | 490 г | 350 ₽ |
| Гавайская | 515 г | 350 ₽ |
| Сырная | 440 г | 350 ₽ |
| BBQ с беконом | 430 г | 350 ₽ |
| Шаверма на тарелке | 650 г | 400 ₽ |
| Мисо суп | 350 мл | 200 ₽ |
| Кокосовый суп | 350 мл | 300 ₽ |
| Картофель фри | 150 г | 150 ₽ |
| Мясная тарелка | 360 г | 380 ₽ |
| Кесадилья | 450 г | 380 ₽ |
| Клаб-сэндвич | 350 г | 330 ₽ |
| Фиш-н-чипс | 400 г | 380 ₽ |
| Английский завтрак | 540 г | 400 ₽ |
