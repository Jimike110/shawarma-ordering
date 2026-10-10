ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS allergens text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS shop_name text NOT NULL DEFAULT 'Шаверма на районе';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT 'Белорусская, 4';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT 'Санкт-Петербург';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS hours_note text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS map_url text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS opening_hours jsonb NOT NULL DEFAULT '[]';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS schedule_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS staff_name text NOT NULL DEFAULT 'kitchen';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS credential_hash text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS audit_events (
 id bigserial PRIMARY KEY, staff_name text NOT NULL, action text NOT NULL,
 resource text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
