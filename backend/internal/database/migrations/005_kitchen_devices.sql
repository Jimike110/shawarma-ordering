ALTER TABLE staff_accounts ADD COLUMN account_type text NOT NULL DEFAULT 'person';
ALTER TABLE staff_accounts ADD COLUMN kitchen_store_id bigint REFERENCES stores(id);
ALTER TABLE staff_accounts ADD CONSTRAINT staff_account_type CHECK (
 (account_type='person' AND kitchen_store_id IS NULL) OR
 (account_type='kitchen' AND kitchen_store_id IS NOT NULL AND NOT owner AND NOT password_required AND temporary_until IS NULL AND phone='' AND email='')
);
CREATE UNIQUE INDEX one_active_kitchen_account ON staff_accounts(kitchen_store_id) WHERE account_type='kitchen' AND active;

CREATE TABLE kitchen_devices (
 id bigserial PRIMARY KEY,
 secret_hash text NOT NULL UNIQUE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','revoked')),
 pairing_code text NOT NULL,
 pending_until timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 user_id bigint REFERENCES staff_accounts(id),
 store_id bigint REFERENCES stores(id),
 account_version bigint,
 login_until timestamptz,
 last_seen_at timestamptz,
 app_version text NOT NULL DEFAULT '',
 monitoring boolean NOT NULL DEFAULT false,
 audio_ready boolean NOT NULL DEFAULT false,
 volume integer NOT NULL DEFAULT 0 CHECK(volume BETWEEN 0 AND 100),
 connection_ok boolean NOT NULL DEFAULT false,
 last_queue_at timestamptz
);
CREATE INDEX kitchen_devices_store ON kitchen_devices(store_id,state);
ALTER TABLE sessions ADD COLUMN device_id bigint REFERENCES kitchen_devices(id);
CREATE INDEX sessions_device ON sessions(device_id) WHERE device_id IS NOT NULL;
ALTER TABLE audit_events ADD COLUMN device_id bigint REFERENCES kitchen_devices(id);
ALTER TABLE order_events ADD COLUMN device_id bigint REFERENCES kitchen_devices(id);

-- These credentials can only read minimal alert state and report device health.
CREATE TABLE kitchen_alert_tokens (
 device_id bigint PRIMARY KEY REFERENCES kitchen_devices(id),
 token_hash text NOT NULL UNIQUE,
 user_id bigint NOT NULL REFERENCES staff_accounts(id),
 store_id bigint NOT NULL REFERENCES stores(id),
 account_version bigint NOT NULL,
 expires_at timestamptz NOT NULL
);
