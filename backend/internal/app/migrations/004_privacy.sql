CREATE TABLE privacy_versions (
 id bigserial PRIMARY KEY, template_version text NOT NULL,
 operator jsonb NOT NULL, policy text NOT NULL, consent text NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(), actor_id bigint REFERENCES staff_accounts(id)
);
CREATE FUNCTION immutable_privacy_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published privacy versions are immutable'; END $$;
CREATE TRIGGER immutable_privacy BEFORE UPDATE OR DELETE ON privacy_versions
 FOR EACH ROW EXECUTE FUNCTION immutable_privacy_version();
CREATE TABLE privacy_settings (
 id integer PRIMARY KEY CHECK(id=1), draft jsonb NOT NULL DEFAULT '{}',
 revision bigint NOT NULL DEFAULT 1, current_version bigint REFERENCES privacy_versions(id),
 retention_enabled boolean NOT NULL DEFAULT false, last_maintenance_at timestamptz
);
INSERT INTO privacy_settings(id) VALUES(1);
ALTER TABLE orders ADD COLUMN closed_at timestamptz;
ALTER TABLE orders ADD COLUMN retention_reference text NOT NULL DEFAULT 'terminal_event';
ALTER TABLE orders ADD COLUMN personal_erased_at timestamptz;
ALTER TABLE orders ADD COLUMN personal_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN notice_version bigint REFERENCES privacy_versions(id);
ALTER TABLE orders ADD COLUMN consent_state text NOT NULL DEFAULT 'unknown';
UPDATE orders SET closed_at=updated_at,retention_reference='legacy_updated_at'
 WHERE status IN ('completed','cancelled');
CREATE INDEX orders_retention ON orders(closed_at) WHERE closed_at IS NOT NULL;
CREATE TABLE privacy_evidence (
 id bigserial PRIMARY KEY, order_ref bigint NOT NULL, purpose text NOT NULL,
 version_id bigint NOT NULL REFERENCES privacy_versions(id), accepted boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '3 years'
);
-- No FK to orders: minimal evidence survives receipt expiry, without receipt content or tokens.
CREATE TABLE expired_order_keys (digest text PRIMARY KEY, store_id bigint NOT NULL REFERENCES stores(id));
CREATE TABLE expired_receipt_tokens (digest text PRIMARY KEY);
CREATE TABLE privacy_requests (
 id bigserial PRIMARY KEY, order_id bigint REFERENCES orders(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('access','correction','withdrawal','erasure','dispute')),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','verified','resolved')),
 verification text NOT NULL DEFAULT '' CHECK(verification IN ('','personal_link_and_purchase','in_person','existing_contact')),
 actor_id bigint NOT NULL REFERENCES staff_accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz, resolved_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '3 years'
);
CREATE TABLE privacy_destructions (
 event_id text PRIMARY KEY, target_kind text NOT NULL, target_id bigint NOT NULL,
 operation text NOT NULL, categories text NOT NULL, reason text NOT NULL, executed_at timestamptz NOT NULL,
 actor_id bigint REFERENCES staff_accounts(id), expires_at timestamptz NOT NULL
);
CREATE TABLE analytics_archive (
 store_id bigint NOT NULL REFERENCES stores(id), day date NOT NULL, status text NOT NULL,
 orders bigint NOT NULL DEFAULT 0, value bigint NOT NULL DEFAULT 0,
 prep_sum double precision NOT NULL DEFAULT 0, prep_samples bigint NOT NULL DEFAULT 0,
 ready_sum double precision NOT NULL DEFAULT 0, ready_samples bigint NOT NULL DEFAULT 0,
 late bigint NOT NULL DEFAULT 0, deadline_samples bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(store_id,day,status)
);
CREATE TABLE analytics_product_archive (
 store_id bigint NOT NULL REFERENCES stores(id), day date NOT NULL, name text NOT NULL,
 quantity bigint NOT NULL, value bigint NOT NULL, PRIMARY KEY(store_id,day,name)
);
ALTER TABLE staff_accounts ADD COLUMN disabled_at timestamptz;
ALTER TABLE staff_accounts ADD COLUMN contacts_erased_at timestamptz;
UPDATE staff_accounts SET disabled_at=now() WHERE NOT active;
CREATE FUNCTION staff_disabled_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT NEW.active THEN NEW.disabled_at=now(); END IF;
  RETURN NEW;
 END IF;
 IF NEW.active THEN NEW.disabled_at=NULL; NEW.contacts_erased_at=NULL;
 ELSIF OLD.active THEN NEW.disabled_at=now(); NEW.contacts_erased_at=NULL;
 ELSIF NEW.contacts_erased_at IS NOT DISTINCT FROM OLD.contacts_erased_at AND
 (NEW.phone IS DISTINCT FROM OLD.phone OR NEW.email IS DISTINCT FROM OLD.email OR NEW.username IS DISTINCT FROM OLD.username OR NEW.display_name IS DISTINCT FROM OLD.display_name)
 THEN NEW.contacts_erased_at=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_disabled_at BEFORE INSERT OR UPDATE ON staff_accounts FOR EACH ROW EXECUTE FUNCTION staff_disabled_timestamp();

-- Only genuine order_events contribute to timing statistics. Retention references never do.
CREATE VIEW privacy_analytics AS
 SELECT store_id,(o.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,o.status,
 count(*) orders,COALESCE(sum(total) FILTER(WHERE o.status='completed'),0) value,
 COALESCE(sum(extract(epoch FROM ready-preparing)/60) FILTER(WHERE ready>=preparing),0)::double precision prep_sum,
 count(*) FILTER(WHERE ready>=preparing) prep_samples,
 COALESCE(sum(extract(epoch FROM ready-o.created_at)/60) FILTER(WHERE ready IS NOT NULL AND initial_ready_at IS NOT NULL),0)::double precision ready_sum,
 count(*) FILTER(WHERE ready IS NOT NULL AND initial_ready_at IS NOT NULL) ready_samples,
 count(*) FILTER(WHERE ready>initial_ready_at) late,
 count(*) FILTER(WHERE ready IS NOT NULL AND initial_ready_at IS NOT NULL) deadline_samples
 FROM orders o LEFT JOIN LATERAL
 (SELECT min(created_at) FILTER(WHERE status='preparing') preparing,min(created_at) FILTER(WHERE status='ready') ready FROM order_events WHERE order_id=o.id) e ON true
 GROUP BY 1,2,3
 UNION ALL SELECT store_id,day,status,orders,value,prep_sum,prep_samples,ready_sum,ready_samples,late,deadline_samples FROM analytics_archive;
CREATE VIEW privacy_product_analytics AS
 SELECT store_id,(created_at AT TIME ZONE 'Europe/Moscow')::date AS day,item->>'name' name,
 sum((item->>'quantity')::bigint) quantity,sum((item->>'quantity')::bigint*(item->>'price')::bigint) value
 FROM orders CROSS JOIN LATERAL jsonb_array_elements(items) item WHERE status='completed' GROUP BY 1,2,3
 UNION ALL SELECT store_id,day,name,quantity,value FROM analytics_product_archive;
