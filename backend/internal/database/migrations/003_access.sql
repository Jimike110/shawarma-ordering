CREATE TABLE stores (
 id bigserial PRIMARY KEY, slug text NOT NULL UNIQUE,
 published boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 owner_stopped boolean NOT NULL DEFAULT false, stop_reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO stores(id,slug,published) VALUES(1,'belorusskaya-4',true);
SELECT setval(pg_get_serial_sequence('stores','id'),1);
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_id_check;
ALTER TABLE settings ADD CONSTRAINT settings_store FOREIGN KEY(id) REFERENCES stores(id);
ALTER TABLE products ADD COLUMN store_id bigint NOT NULL DEFAULT 1 REFERENCES stores(id);
ALTER TABLE orders ADD COLUMN store_id bigint NOT NULL DEFAULT 1 REFERENCES stores(id);
ALTER TABLE orders ADD COLUMN store_slug text NOT NULL DEFAULT 'belorusskaya-4';
ALTER TABLE orders ADD COLUMN shop jsonb NOT NULL DEFAULT '{}';
UPDATE orders SET shop=(SELECT to_jsonb(s)-'id' FROM settings s WHERE id=1);
ALTER TABLE orders ADD COLUMN initial_ready_at timestamptz;
ALTER TABLE orders ADD COLUMN cancelled_by text NOT NULL DEFAULT '';
CREATE INDEX products_store ON products(store_id,sort_order,id);
CREATE INDEX orders_store_queue ON orders(store_id,status,created_at);
CREATE TABLE staff_accounts (
 id bigserial PRIMARY KEY, username text NOT NULL UNIQUE,
 display_name text NOT NULL, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
 owner boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 password_hash text NOT NULL, password_required boolean NOT NULL DEFAULT false,
 temporary_until timestamptz, version bigint NOT NULL DEFAULT 1,
 last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE staff_memberships (
 user_id bigint NOT NULL REFERENCES staff_accounts(id), store_id bigint NOT NULL REFERENCES stores(id),
 role text NOT NULL CHECK(role IN ('manager','worker')), PRIMARY KEY(user_id,store_id)
);
DELETE FROM sessions;
ALTER TABLE sessions ADD COLUMN user_id bigint REFERENCES staff_accounts(id);
ALTER TABLE sessions ADD COLUMN account_version bigint NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN confirmed_at timestamptz;
ALTER TABLE audit_events ADD COLUMN actor_id bigint REFERENCES staff_accounts(id);
ALTER TABLE audit_events ADD COLUMN store_id bigint REFERENCES stores(id);
ALTER TABLE audit_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
CREATE INDEX audit_store_time ON audit_events(store_id,created_at);
CREATE TABLE order_events (
 id bigserial PRIMARY KEY, order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 store_id bigint NOT NULL REFERENCES stores(id), actor_id bigint REFERENCES staff_accounts(id),
 status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order ON order_events(order_id,status,created_at);
CREATE TABLE menu_copies (
 request_key text PRIMARY KEY, request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
