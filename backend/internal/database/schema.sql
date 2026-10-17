CREATE TABLE IF NOT EXISTS products (
 id bigserial PRIMARY KEY, name text NOT NULL, description text NOT NULL,
 price integer NOT NULL CHECK (price BETWEEN 1 AND 1000000),
 image text NOT NULL, weight text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'Шаверма',
 available boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
 id integer PRIMARY KEY CHECK(id=1), paused boolean NOT NULL DEFAULT false,
 prep_minutes integer NOT NULL DEFAULT 15 CHECK(prep_minutes BETWEEN 1 AND 120),
 pause_message text NOT NULL DEFAULT 'Приём заказов временно приостановлен. Попробуйте чуть позже.'
);
INSERT INTO settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE SEQUENCE IF NOT EXISTS order_numbers START 101;
CREATE TABLE IF NOT EXISTS orders (
 id bigserial PRIMARY KEY, number bigint NOT NULL UNIQUE DEFAULT nextval('order_numbers'),
 token_hash text NOT NULL UNIQUE, request_key text NOT NULL UNIQUE, request_hash text NOT NULL,
 customer_name text NOT NULL, note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','preparing','ready','completed','cancelled')),
 total integer NOT NULL CHECK(total>0), items jsonb NOT NULL,
 estimated_ready_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_queue ON orders(status,created_at);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 1);
INSERT INTO products(id,name,description,price,image,weight,sort_order) VALUES
 (1,'Классическая','Курица с гриля, свежие овощи и чесночный соус в хрустящем лаваше.',290,'/images/classic.jpg','350 г',1),
 (2,'Острая','Курица, капуста, томаты и острый соус. Для тех, кто любит погорячее.',320,'/images/spicy.jpg','350 г',2),
 (3,'Сырная','Классическая шаверма с двойной порцией сыра и нежным соусом.',350,'/images/classic.jpg','380 г',3)
 ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('products','id'),GREATEST((SELECT COALESCE(max(id),1) FROM products),1));
