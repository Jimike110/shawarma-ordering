// Explicit local catalogue import. Generates reviewable SQL; never writes to a database.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const storeId = Number(process.env.STORE_ID);
if (!Number.isSafeInteger(storeId) || storeId < 1)
  throw new Error('Set STORE_ID to the intended target store before preparing an import.');
const manifestURL = new URL('config/menu.json', root);
const manifest = JSON.parse(await readFile(manifestURL, 'utf8'));
if (manifest.source_organization_id !== '223602659821' || manifest.products.length !== 19)
  throw new Error(
    'Unexpected catalogue source or size. Review the import script for a new source.',
  );
const paths = new Set();
for (const product of manifest.products) {
  if (
    !product.name ||
    product.name.length > 100 ||
    !Number.isInteger(product.price) ||
    product.price < 1 ||
    product.price > 1000000 ||
    !/^\/images\/menu\/[a-z0-9-]+\.jpg$/.test(product.image) ||
    paths.has(product.image) ||
    !Number.isInteger(product.sort_order) ||
    product.sort_order < 1 ||
    product.sort_order > 10000 ||
    !product.category ||
    !product.weight
  )
    throw new Error('Invalid catalogue product.');
  const imageSource = new URL(product.image_source);
  if (
    imageSource.protocol !== 'https:' ||
    imageSource.hostname !== 'avatars.mds.yandex.net' ||
    !imageSource.pathname.startsWith('/get-sprav-products/') ||
    imageSource.username ||
    imageSource.password
  )
    throw new Error('Unexpected photo host.');
  paths.add(product.image);
  const photoURL = new URL(`public${product.image}`, root);
  if (process.argv.includes('--download-photos')) {
    const response = await fetch(imageSource, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg'))
      throw new Error(`Photo download failed for ${product.name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1000 || bytes.length > 8000000 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw new Error(`Invalid JPEG for ${product.name}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (product.image_sha256 && product.image_sha256 !== digest)
      throw new Error(
        `Source photo changed for ${product.name}. Review it before changing the recorded checksum.`,
      );
    await mkdir(new URL('public/images/menu/', root), { recursive: true });
    await writeFile(photoURL, bytes);
    product.image_sha256 = digest;
    console.log(`Downloaded ${product.name}: ${bytes.length} bytes`);
  }
  const bytes = await readFile(photoURL);
  if (
    !product.image_sha256 ||
    createHash('sha256').update(bytes).digest('hex') !== product.image_sha256
  )
    throw new Error(`Local photo checksum mismatch for ${product.name}`);
}
if (process.argv.includes('--download-photos'))
  await writeFile(manifestURL, JSON.stringify(manifest, null, 2) + '\n');

// Base64 contains no SQL quote/backslash metacharacters. PostgreSQL decodes the exact JSON.
const catalog = Buffer.from(JSON.stringify(manifest.products)).toString('base64');
const sql = `\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM stores WHERE id=${storeId} AND NOT archived) THEN RAISE EXCEPTION 'Target store unavailable'; END IF; END $$;
SELECT id FROM stores WHERE id=${storeId} FOR UPDATE;
SELECT id FROM settings WHERE id=${storeId} FOR UPDATE;
CREATE TEMP TABLE imported_menu ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset(convert_from(decode('${catalog}','base64'),'UTF8')::jsonb)
AS p(name text, price integer, image text, weight text, category text, sort_order integer);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM products p JOIN imported_menu m USING (image) WHERE p.store_id=${storeId} AND p.topping_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Snapshot matches a canonical topping offer: review identity and use the topping editor instead'; END IF;
  IF EXISTS (SELECT 1 FROM products p JOIN imported_menu m USING (image) WHERE p.store_id=${storeId} GROUP BY p.image HAVING count(*) > 1)
  THEN RAISE EXCEPTION 'Duplicate existing menu photo: resolve product matching before importing'; END IF;
END $$;
-- Reapplying this snapshot updates the catalogue fields, preserving IDs, stock, and staff composition/options.
UPDATE products p SET name=m.name, price=m.price, weight=m.weight, category=m.category, sort_order=m.sort_order
FROM imported_menu m WHERE p.image=m.image AND p.store_id=${storeId};
INSERT INTO products(name,description,price,image,weight,category,available,sort_order,store_id)
SELECT m.name,'',m.price,m.image,m.weight,m.category,true,m.sort_order,${storeId}
FROM imported_menu m WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.image=m.image AND p.store_id=${storeId});
-- Remove only untouched original demo rows. Never reuse their IDs or modify historic order snapshots.
DELETE FROM products WHERE store_id=${storeId} AND ingredients='' AND allergens='' AND options='[]'::jsonb
AND category='Шаверма' AND available=true
AND (id,name,description,price,image,weight,sort_order) IN (
  (1,'Классическая','Курица с гриля, свежие овощи и чесночный соус в хрустящем лаваше.',290,'/images/classic.jpg','350 г',1),
  (2,'Острая','Курица, капуста, томаты и острый соус. Для тех, кто любит погорячее.',320,'/images/spicy.jpg','350 г',2),
  (3,'Сырная','Классическая шаверма с двойной порцией сыра и нежным соусом.',350,'/images/classic.jpg','380 г',3));
UPDATE settings SET demo_mode=false,map_url='https://yandex.ru/maps/org/ya_lyublyu_shavermu/223602659821/' WHERE id=${storeId};
INSERT INTO audit_events(staff_name,store_id,action,resource) VALUES ('local-menu-import',${storeId},'menu.import','yandex:223602659821:2026-10-10');
SELECT count(*) AS imported_products FROM products p JOIN imported_menu m USING (image) WHERE p.store_id=${storeId};
COMMIT;
`;
await mkdir(new URL('artifacts/', root), { recursive: true });
const sqlURL = new URL('artifacts/import-menu.sql', root);
await writeFile(sqlURL, sql);
console.log(
  `Verified ${manifest.products.length} photos; prepared ${fileURLToPath(sqlURL)}. No database changes made.`,
);
