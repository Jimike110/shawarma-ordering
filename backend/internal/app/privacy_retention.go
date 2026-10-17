package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"
)

type RetentionPreview struct {
	Enabled              bool `json:"enabled"`
	PersonalFields       int  `json:"personal_fields"`
	Receipts             int  `json:"receipts"`
	DisabledStaff        int  `json:"disabled_staff"`
	HistoricalReferences int  `json:"historical_references"`
	SecurityCounters     int  `json:"security_counters"`
	AuditRecords         int  `json:"audit_records"`
	Evidence             int  `json:"evidence"`
	Requests             int  `json:"requests"`
	ExpiredSessions      int  `json:"expired_sessions"`
	DestructionEvidence  int  `json:"destruction_evidence"`
	TelegramMappings     int  `json:"telegram_mappings"`
}

func (s *Store) RetentionPreview(ctx context.Context) (RetentionPreview, error) {
	var p RetentionPreview
	e := s.DB.QueryRowContext(ctx, `SELECT retention_enabled,
 (SELECT count(*) FROM orders WHERE status IN ('completed','cancelled') AND closed_at<=now()-interval '7 days' AND personal_erased_at IS NULL),
 (SELECT count(*) FROM orders WHERE status IN ('completed','cancelled') AND closed_at<=now()-interval '1 year'),
 (SELECT count(*) FROM staff_accounts WHERE NOT active AND disabled_at<=now()-interval '90 days' AND contacts_erased_at IS NULL),
 (SELECT count(*) FROM orders WHERE retention_reference='legacy_updated_at'),
 (SELECT count(*) FROM rate_limits WHERE window_start<=now()-interval '23 hours'),
 (SELECT count(*) FROM audit_events WHERE created_at<=now()-interval '1 year'),
 (SELECT count(*) FROM privacy_evidence WHERE expires_at<=now()),
 (SELECT count(*) FROM privacy_requests WHERE expires_at<=now()),
 (SELECT count(*) FROM sessions WHERE expires_at<=now()),
 (SELECT count(*) FROM privacy_destructions WHERE expires_at<=now()) FROM privacy_settings WHERE id=1`).Scan(&p.Enabled, &p.PersonalFields, &p.Receipts, &p.DisabledStaff, &p.HistoricalReferences, &p.SecurityCounters, &p.AuditRecords, &p.Evidence, &p.Requests, &p.ExpiredSessions, &p.DestructionEvidence)
	if e == nil {
		e = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM telegram_subscriptions t JOIN orders o ON o.id=t.order_id WHERE o.closed_at<=now()-interval '7 days'").Scan(&p.TelegramMappings)
	}
	return p, e
}
func (a *API) privacyRetention(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var in struct {
			Enabled   bool `json:"enabled"`
			Previewed bool `json:"previewed"`
		}
		if !decode(w, r, &in) {
			return
		}
		if in.Enabled && (!in.Previewed || len(a.Store.PrivacyKey) < 32 || a.Store.JournalPath == "") {
			fail(w, problem(400, "Сначала просмотрите объём очистки и настройте отдельный журнал удаления."))
			return
		}
		tx, e := a.Store.DB.BeginTx(r.Context(), nil)
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback()
		result, err := tx.ExecContext(r.Context(), "UPDATE privacy_settings SET retention_enabled=$1 WHERE id=1 AND (NOT $1 OR current_version IS NOT NULL)", in.Enabled)
		e = err
		if e == nil {
			n, _ := result.RowsAffected()
			if n == 0 {
				fail(w, problem(409, "Сначала опубликуйте документы оператора."))
				return
			}
		}
		if e == nil {
			e = audit(r.Context(), tx, "privacy.retention", "settings")
		}
		if e == nil {
			e = tx.Commit()
		}
		if e != nil {
			fail(w, e)
			return
		}
	}
	p, e := a.Store.RetentionPreview(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, p)
}

// One bounded transaction per run. Repeat hourly; after restore drain all overdue work offline.
func (s *Store) PrivacyMaintenance(ctx context.Context, batch int) (int, error) {
	if batch < 1 || batch > 1000 {
		return 0, errors.New("batch must be 1..1000")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()
	var locked bool
	// A separate singleton lock rejects competing maintenance runs. Checkout holds
	// a shared replay lock, so ordinary orders must make cleanup wait, not falsely
	// report that another maintenance worker is already running.
	if e = tx.QueryRowContext(ctx, "SELECT pg_try_advisory_xact_lock(184021)").Scan(&locked); e != nil {
		return 0, e
	}
	if !locked {
		return 0, errors.New("privacy maintenance already running")
	}
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184020)"); e != nil {
		return 0, e
	}
	var enabled bool
	if e = tx.QueryRowContext(ctx, "SELECT retention_enabled FROM privacy_settings WHERE id=1 FOR SHARE").Scan(&enabled); e != nil {
		return 0, e
	}
	if !enabled {
		return 0, errors.New("retention disabled: preview and explicitly activate it first")
	}
	tgCount, e := s.telegramRetention(ctx, tx, batch)
	if e != nil {
		return 0, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT id,CASE WHEN closed_at<=now()-interval '1 year' THEN 'expire' ELSE 'erase' END FROM orders
 WHERE status IN ('completed','cancelled') AND (closed_at<=now()-interval '1 year' OR (closed_at<=now()-interval '7 days' AND personal_erased_at IS NULL)) ORDER BY closed_at,id LIMIT $1 FOR UPDATE`, batch)
	if e != nil {
		return 0, e
	}
	type candidate struct {
		id int64
		op string
	}
	work := []candidate{}
	for rows.Next() {
		var c candidate
		if e = rows.Scan(&c.id, &c.op); e != nil {
			rows.Close()
			return 0, e
		}
		work = append(work, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	for _, c := range work {
		entry, err := s.journalEntry(ctx, tx, "order", c.id, c.op, "retention")
		if err != nil {
			return 0, err
		}
		if c.op == "expire" {
			e = s.archiveReceipt(ctx, tx, c.id)
		} else {
			e = erasePersonal(ctx, tx, c.id)
		}
		if e == nil {
			e = recordDestruction(ctx, tx, entry)
		}
		if e != nil {
			return 0, e
		}
	}
	if remaining := batch - len(work); remaining > 0 {
		rows, e = tx.QueryContext(ctx, "SELECT id FROM staff_accounts WHERE NOT active AND disabled_at<=now()-interval '90 days' AND contacts_erased_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE", remaining)
		if e != nil {
			return 0, e
		}
		ids := []int64{}
		for rows.Next() {
			var id int64
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return 0, e
			}
			ids = append(ids, id)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return 0, e
		}
		for _, id := range ids {
			entry, err := s.journalEntry(ctx, tx, "staff", id, "erase", "retention")
			if err != nil {
				return 0, err
			}
			if e = eraseAccount(ctx, tx, id); e == nil {
				e = recordDestruction(ctx, tx, entry)
			}
			if e != nil {
				return 0, e
			}
			work = append(work, candidate{id, "staff"})
		}
	}
	for _, q := range []string{
		"DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=now() LIMIT $1)",
		"DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE window_start<=now()-interval '23 hours' LIMIT $1)",
		"DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE created_at<=now()-interval '1 year' LIMIT $1)",
		"DELETE FROM privacy_evidence WHERE id IN (SELECT id FROM privacy_evidence WHERE expires_at<=now() LIMIT $1)",
		"DELETE FROM privacy_requests WHERE id IN (SELECT id FROM privacy_requests WHERE expires_at<=now() LIMIT $1)",
		"DELETE FROM privacy_destructions WHERE event_id IN (SELECT event_id FROM privacy_destructions WHERE expires_at<=now() LIMIT $1)",
	} {
		if _, e = tx.ExecContext(ctx, q, batch); e != nil {
			return 0, e
		}
	}
	if _, e = tx.ExecContext(ctx, "UPDATE privacy_settings SET last_maintenance_at=$1 WHERE id=1", time.Now().UTC()); e != nil {
		return 0, e
	}
	if e = telegramSecurityCleanup(ctx, tx); e != nil {
		return 0, e
	}
	return len(work) + tgCount, tx.Commit()
}

func (s *Store) archiveReceipt(ctx context.Context, tx *sql.Tx, id int64) error {
	var key, tokenHash string
	var storeID int64
	e := tx.QueryRowContext(ctx, "SELECT request_key,token_hash,store_id FROM orders WHERE id=$1 FOR UPDATE", id).Scan(&key, &tokenHash, &storeID)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `WITH timed AS (SELECT o.*,e.preparing,e.ready FROM orders o LEFT JOIN LATERAL
 (SELECT min(created_at) FILTER(WHERE status='preparing') preparing,min(created_at) FILTER(WHERE status='ready') ready FROM order_events WHERE order_id=o.id) e ON true WHERE o.id=$1)
 INSERT INTO analytics_archive(store_id,day,status,orders,value,prep_sum,prep_samples,ready_sum,ready_samples,late,deadline_samples)
 SELECT store_id,(created_at AT TIME ZONE 'Europe/Moscow')::date,status,1,CASE WHEN status='completed' THEN total ELSE 0 END,
 CASE WHEN ready>=preparing THEN extract(epoch FROM ready-preparing)/60 ELSE 0 END,CASE WHEN ready>=preparing THEN 1 ELSE 0 END,
 CASE WHEN ready IS NOT NULL AND initial_ready_at IS NOT NULL THEN extract(epoch FROM ready-created_at)/60 ELSE 0 END,
 CASE WHEN ready IS NOT NULL AND initial_ready_at IS NOT NULL THEN 1 ELSE 0 END,CASE WHEN ready>initial_ready_at THEN 1 ELSE 0 END,
 CASE WHEN ready IS NOT NULL AND initial_ready_at IS NOT NULL THEN 1 ELSE 0 END FROM timed
 ON CONFLICT(store_id,day,status) DO UPDATE SET orders=analytics_archive.orders+1,value=analytics_archive.value+excluded.value,
 prep_sum=analytics_archive.prep_sum+excluded.prep_sum,prep_samples=analytics_archive.prep_samples+excluded.prep_samples,
 ready_sum=analytics_archive.ready_sum+excluded.ready_sum,ready_samples=analytics_archive.ready_samples+excluded.ready_samples,
 late=analytics_archive.late+excluded.late,deadline_samples=analytics_archive.deadline_samples+excluded.deadline_samples`, id)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO analytics_product_archive(store_id,day,name,quantity,value)
 SELECT store_id,(created_at AT TIME ZONE 'Europe/Moscow')::date,item->>'name',sum((item->>'quantity')::bigint),sum((item->>'quantity')::bigint*(item->>'price')::bigint)
 FROM orders CROSS JOIN LATERAL jsonb_array_elements(items) item WHERE id=$1 AND status='completed' GROUP BY 1,2,3
 ON CONFLICT(store_id,day,name) DO UPDATE SET quantity=analytics_product_archive.quantity+excluded.quantity,value=analytics_product_archive.value+excluded.value`, id)
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO expired_order_keys VALUES($1,$2) ON CONFLICT DO NOTHING", s.privacyDigest("retry", key), storeID); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO expired_receipt_tokens VALUES($1) ON CONFLICT DO NOTHING", s.privacyDigest("receipt", tokenHash)); e != nil {
		return e
	}
	if e = erasePersonal(ctx, tx, id); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "DELETE FROM orders WHERE id=$1", id)
	return e
}
