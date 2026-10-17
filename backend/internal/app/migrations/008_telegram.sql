-- Optional customer integration. No configuration or publication is activated here.
ALTER TABLE privacy_versions ADD COLUMN telegram_consent text NOT NULL DEFAULT '';
CREATE TABLE telegram_sessions (
 token_hash text PRIMARY KEY, recipient bigint NOT NULL CHECK(recipient>0),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_sessions_expiry ON telegram_sessions(expires_at);
CREATE TABLE telegram_intents (
 id text PRIMARY KEY, recipient bigint NOT NULL, request_key text NOT NULL,
 store_id bigint NOT NULL REFERENCES stores(id), version_id bigint NOT NULL REFERENCES privacy_versions(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour', used boolean NOT NULL DEFAULT false
);
CREATE TABLE telegram_subscriptions (
 order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
 recipient bigint NOT NULL, handle text NOT NULL UNIQUE,
 version_id bigint NOT NULL REFERENCES privacy_versions(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_intents_expiry ON telegram_intents(expires_at);
CREATE INDEX telegram_subscriptions_recipient ON telegram_subscriptions(recipient);
CREATE TABLE telegram_outbox (
 id bigserial PRIMARY KEY, order_id bigint NOT NULL REFERENCES telegram_subscriptions(order_id) ON DELETE CASCADE,
 event text NOT NULL CHECK(event IN ('accepted','ready','cancelled')), state text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
 lease text, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(order_id,event)
);
CREATE INDEX telegram_outbox_due ON telegram_outbox(next_at) WHERE state='pending';
CREATE TABLE telegram_updates (id bigint PRIMARY KEY, expires_at timestamptz NOT NULL DEFAULT now()+interval '23 hours');
CREATE TABLE telegram_health (id integer PRIMARY KEY CHECK(id=1), last_dispatch timestamptz, last_sent timestamptz, error_code text NOT NULL DEFAULT '', lease text, lease_until timestamptz);
INSERT INTO telegram_health(id) VALUES(1);
