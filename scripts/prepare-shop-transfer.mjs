// Read only public local shop data and prepare SQL. Never connects to the target database.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const storeId = Number(process.env.STORE_ID);
if (!Number.isSafeInteger(storeId) || storeId < 1)
  throw new Error('Set STORE_ID to the intended target store before preparing an import.');
const source = new URL(process.env.LOCAL_API_URL ?? 'http://localhost:5173');
if (
  source.protocol !== 'http:' ||
  !['localhost', '127.0.0.1', 'web', 'host.docker.internal'].includes(source.hostname) ||
  source.username ||
  source.password ||
  source.search ||
  source.hash ||
  source.pathname !== '/'
)
  throw new Error('LOCAL_API_URL must be the origin of the local app.');

const response = await fetch(new URL('/api/menu', source), {
  redirect: 'error',
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`Local menu request failed: HTTP ${response.status}`);
const menu = await response.json();
const manifest = JSON.parse(await readFile(new URL('config/menu.json', root), 'utf8'));
if (!Array.isArray(menu.products) || menu.products.length !== manifest.products.length)
  throw new Error(
    'Local catalogue size differs from the approved manifest; review before transferring.',
  );
if (menu.settings?.demo_mode !== false)
  throw new Error('The source is still in demo mode; refusing to export demo content.');

const productKeys = [
  'name',
  'description',
  'price',
  'image',
  'weight',
  'category',
  'available',
  'sort_order',
  'ingredients',
  'allergens',
  'options',
];
const settingKeys = [
  'paused',
  'prep_minutes',
  'pause_message',
  'shop_name',
  'address',
  'city',
  'phone',
  'hours_note',
  'map_url',
  'opening_hours',
  'schedule_enabled',
  'demo_mode',
];
const pick = (object, keys) =>
  Object.fromEntries(
    keys.map((key) => {
      if (!Object.hasOwn(object, key)) throw new Error(`Missing source field: ${key}`);
      return [key, object[key]];
    }),
  );
const products = menu.products.map((product) => pick(product, productKeys));
const settings = pick(menu.settings, settingKeys);
const seen = new Set();
for (const product of products) {
  const expected = manifest.products.find((item) => item.image === product.image);
  if (
    !expected ||
    seen.has(product.image) ||
    !/^\/images\/menu\/[a-z0-9-]+\.jpg$/.test(product.image)
  )
    throw new Error('Unexpected or duplicate local product image; review before transferring.');
  seen.add(product.image);
  const bytes = await readFile(new URL(`public${product.image}`, root));
  if (createHash('sha256').update(bytes).digest('hex') !== expected.image_sha256)
    throw new Error(`Photo checksum mismatch: ${product.image}`);
}

// Match the bootstrap defaults, allowing the older catalogue-only import's map/demo changes.
const defaults = {
  paused: false,
  prep_minutes: 15,
  pause_message: 'Приём заказов временно приостановлен. Попробуйте чуть позже.',
  shop_name: 'Шаверма на районе',
  address: 'Белорусская, 4',
  city: 'Санкт-Петербург',
  phone: '',
  hours_note: '',
  opening_hours: [],
  schedule_enabled: false,
};
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const generatedAt = new Date().toISOString();
const sql = `-- One-time shop transfer, generated ${generatedAt}.
-- Source: public local menu only. No orders, tokens, sessions, or credentials.
-- Run the entire DO statement in the intended migrated Neon database.
-- Atomic: any error rolls back all changes. Never bypass conflict checks blindly.
DO $shop_transfer$
DECLARE
  source_settings jsonb := convert_from(decode('${encode(settings)}','base64'),'UTF8')::jsonb;
  default_settings jsonb := convert_from(decode('${encode(defaults)}','base64'),'UTF8')::jsonb;
  target_settings jsonb;
BEGIN
  PERFORM id FROM stores WHERE id=${storeId} AND NOT archived FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target store unavailable'; END IF;
  SELECT to_jsonb(s)-'id' INTO target_settings FROM settings s WHERE id=${storeId} FOR UPDATE;
  IF target_settings IS NULL THEN
    RAISE EXCEPTION 'Settings missing: run application migrations before importing';
  END IF;
  IF target_settings IS DISTINCT FROM source_settings
     AND (target_settings-'demo_mode'-'map_url') IS DISTINCT FROM default_settings THEN
    RAISE EXCEPTION 'Hosted shop settings have been edited; review them before transferring';
  END IF;

  CREATE TEMP TABLE transferred_menu ON COMMIT DROP AS
  SELECT * FROM jsonb_to_recordset(convert_from(decode('${encode(products)}','base64'),'UTF8')::jsonb)
  AS p(name text, description text, price integer, image text, weight text, category text,
       available boolean, sort_order integer, ingredients text, allergens text, options jsonb);

  IF EXISTS (SELECT 1 FROM products p JOIN transferred_menu m USING (image)
             WHERE p.store_id=${storeId} GROUP BY p.image HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate hosted product image: resolve matching before transferring';
  END IF;
  IF EXISTS (SELECT 1 FROM products p JOIN transferred_menu m USING (image)
             WHERE p.store_id=${storeId} AND (to_jsonb(p)-'id'-'store_id') IS DISTINCT FROM to_jsonb(m)) THEN
    RAISE EXCEPTION 'Hosted menu has differing product edits; review them before transferring';
  END IF;

  INSERT INTO products(name,description,price,image,weight,category,available,sort_order,ingredients,allergens,options,store_id)
  SELECT m.name,m.description,m.price,m.image,m.weight,m.category,m.available,m.sort_order,m.ingredients,m.allergens,m.options,${storeId}
  FROM transferred_menu m WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.image=m.image AND p.store_id=${storeId});

  -- Remove only the three completely untouched demo fixtures; retain other hosted products.
  DELETE FROM products WHERE store_id=${storeId} AND ingredients='' AND allergens='' AND options='[]'::jsonb
  AND category='Шаверма' AND available=true
  AND (id,name,description,price,image,weight,sort_order) IN (
    (1,'Классическая','Курица с гриля, свежие овощи и чесночный соус в хрустящем лаваше.',290,'/images/classic.jpg','350 г',1),
    (2,'Острая','Курица, капуста, томаты и острый соус. Для тех, кто любит погорячее.',320,'/images/spicy.jpg','350 г',2),
    (3,'Сырная','Классическая шаверма с двойной порцией сыра и нежным соусом.',350,'/images/classic.jpg','380 г',3));

  UPDATE settings s SET
    paused=v.paused, prep_minutes=v.prep_minutes, pause_message=v.pause_message,
    shop_name=v.shop_name, address=v.address, city=v.city, phone=v.phone,
    hours_note=v.hours_note, map_url=v.map_url, opening_hours=v.opening_hours,
    schedule_enabled=v.schedule_enabled, demo_mode=v.demo_mode
  FROM jsonb_to_record(source_settings) AS v(
    paused boolean, prep_minutes integer, pause_message text, shop_name text, address text,
    city text, phone text, hours_note text, map_url text, opening_hours jsonb,
    schedule_enabled boolean, demo_mode boolean)
  WHERE s.id=${storeId};
  INSERT INTO audit_events(staff_name,store_id,action,resource)
  VALUES ('local-shop-transfer',${storeId},'shop.import','public-local-snapshot:${generatedAt}');
  RAISE NOTICE 'Transferred % products and current shop settings; existing orders untouched',
    (SELECT count(*) FROM transferred_menu);
END
$shop_transfer$;

-- Optional verification after the import.
SELECT count(*) AS product_count FROM products WHERE store_id=${storeId};
SELECT shop_name,address,city,phone,prep_minutes,opening_hours,demo_mode FROM settings WHERE id=${storeId};
`;
await mkdir(new URL('artifacts/', root), { recursive: true });
await writeFile(
  new URL('artifacts/shop-transfer.json', root),
  JSON.stringify({ generatedAt, products, settings }, null, 2) + '\n',
);
const sqlURL = new URL('artifacts/import-shop.sql', root);
await writeFile(sqlURL, sql);
console.log(`Verified ${products.length} photos; exported current public shop data.`);
console.log(`Prepared ${fileURLToPath(sqlURL)}. Review it and shop-transfer.json before applying.`);
console.log(
  'No database changes made. Hosted staff edits cause the import to abort rather than overwrite them.',
);
