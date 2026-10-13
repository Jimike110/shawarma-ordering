# Shop menu source and import

The user selected [Yandex Maps organization 223602659821](https://yandex.ru/maps/org/ya_lyublyu_shavermu/223602659821/menu/) as the source of product photos and prices on **2026-10-10**. Its address is **Белорусская ул., 4, Санкт-Петербург** and its listing name is **Я@Ша**. The original user-provided name was **Я люблю шаверму**; current kitchen settings use **Я@Ша**. The import preserves the current shop name rather than overwriting staff edits. Opening hours remain the user's daily 09:00–22:00 schedule.

The snapshot contains **19 products**: 11 shawarma items, 2 soups, and 6 fast-food items. `config/menu.json` records the listing metadata, original names, lightly normalized display names, exact prices in rubles, portion sizes, local photo paths, CDN source URLs, and SHA-256 checksums. This is an explicit, dated import, not continuous synchronization with Yandex. Future staff menu edits do not require reimporting.

The listing has no full ingredient/allergen descriptions or priced extras. Imported items therefore start with empty descriptions/ingredients/allergens and no options. Do not infer a recipe, certification, or allergen safety from a name or photo. Phone and any schedule exceptions still need confirmation.

The 19 photos are downloaded **XXL JPEG variants**, served from `public/images/menu/`, roughly 61–265 KiB each. They retain the CDN-provided content without retouching. The app does not depend on Yandex at browsing/checkout time. This user-selected material is not claimed to be openly licensed; see [photo provenance](../public/images/CREDITS.md).

## Apply to a fresh local installation

Configure/start the normal app first as described in the README, then apply `config/shop.json`. Back up any existing database before importing. The running app in this workspace already has this import applied.

```powershell
docker compose --profile operations run --rm backups --once
docker compose -f compose.yaml -f compose.tools.yaml run --rm --no-deps -e STORE_ID=1 frontend-tools node scripts/prepare-menu-import.mjs
docker compose --profile operations up -d --build web
docker compose --profile operations cp artifacts/import-menu.sql db:/tmp/import-menu.sql
docker compose --profile operations exec -T db psql -U shawarma -d shawarma -f /tmp/import-menu.sql
docker compose --profile operations run --rm backups --once
```

The preparation script checks the local photos against their recorded checksums and generates `artifacts/import-menu.sql` without touching a database. Images are already included in the repository. Optional `--download-photos` downloads them from the recorded CDN URLs; it rejects a changed checksum rather than silently accepting a new photo. Review the JSON, photo files, and generated SQL before applying to a different installation.

The SQL runs in one transaction under the same settings lock used by checkout/product edits. It matches previously imported products by their local image paths. Reapplying updates names/prices/portion sizes/categories/order, retains existing IDs and staff availability/description/ingredients/allergens/options, and creates no duplicates. Changing a photo path changes the match; review migrations manually instead of blindly reimporting after such an edit.

Only the three **untouched original demo rows** are removed, checked by ID, name, price, photo, description, portion size, category, sort order, availability, and empty composition/options. Staff-edited or other products remain. New items receive new IDs, so old demo cart lines become invalid instead of being reassigned to different dishes. Old order item/option/name/price snapshots are never rewritten. Duplicate existing matches abort the entire transaction. The import records an audit event as `local-menu-import`, sets demo mode off, and applies the exact listing link for directions; other shop settings stay unchanged.

The PostgreSQL bootstrap demo catalogue remains for fresh databases and automated fixtures. Do not edit an already-applied schema/migration to change a running shop's content.

## Transfer current staff data to Neon

Use `scripts/prepare-shop-transfer.mjs` and the [deployment transfer instructions](DEPLOYMENT.md#transfer-the-current-menu-and-shop-settings-into-a-fresh-hosted-database) when launching the hosted shop. Unlike the manifest-only catalogue import, this reads the current local public API and includes current stock, composition/options, preparation time, phone, name, address, and schedule. The latest staff-edited schedule is 11:00–22:00 daily, not the original 09:00 opening time. It produces pure SQL suitable for the SQL Editor, without orders or credentials. Review the companion JSON before applying. Conflicting hosted staff edits abort the transfer; future operational updates belong in the hosted kitchen panel.

## Imported catalogue

| Item                            | Portion | Price |
| ------------------------------- | ------- | ----: |
| Шаверма в пите                  | 360 г   | 280 ₽ |
| Шаверма в лаваше                | 420 г   | 330 ₽ |
| Веган                           | 400 г   | 220 ₽ |
| Шаверма с маринованной капустой | 430 г   | 330 ₽ |
| Рыба-Фиш                        | 400 г   | 350 ₽ |
| Шавер-Дог                       | 400 г   | 300 ₽ |
| Шаверма по-деревенски           | 490 г   | 350 ₽ |
| Гавайская                       | 515 г   | 350 ₽ |
| Сырная                          | 440 г   | 350 ₽ |
| BBQ с беконом                   | 430 г   | 350 ₽ |
| Шаверма на тарелке              | 650 г   | 400 ₽ |
| Мисо суп                        | 350 мл  | 200 ₽ |
| Кокосовый суп                   | 350 мл  | 300 ₽ |
| Картофель фри                   | 150 г   | 150 ₽ |
| Мясная тарелка                  | 360 г   | 380 ₽ |
| Кесадилья                       | 450 г   | 380 ₽ |
| Клаб-сэндвич                    | 350 г   | 330 ₽ |
| Фиш-н-чипс                      | 400 г   | 380 ₽ |
| Английский завтрак              | 540 г   | 400 ₽ |
