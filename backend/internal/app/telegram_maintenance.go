package app

import (
	"context"
	"database/sql"
)

func (s *Store) eraseTelegramRecipient(ctx context.Context, recipient int64, reason string) error {
	rows, e := s.DB.QueryContext(ctx, "SELECT order_id FROM telegram_subscriptions WHERE recipient=$1", recipient)
	if e != nil {
		return e
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	return s.eraseTelegramOrders(ctx, ids, reason)
}

func telegramSecurityCleanup(ctx context.Context, tx *sql.Tx) error {
	for _, q := range []string{
		"DELETE FROM telegram_sessions WHERE token_hash IN (SELECT token_hash FROM telegram_sessions WHERE expires_at<=now() LIMIT 1000)",
		"DELETE FROM telegram_intents WHERE id IN (SELECT id FROM telegram_intents WHERE expires_at<=now() OR used LIMIT 1000)",
		"DELETE FROM telegram_updates WHERE id IN (SELECT id FROM telegram_updates WHERE expires_at<=now() LIMIT 1000)",
	} {
		if _, e := tx.ExecContext(ctx, q); e != nil {
			return e
		}
	}
	return nil
}

// Explicit privacy maintenance remains the only automatic erasure of order mappings.
func (s *Store) telegramRetention(ctx context.Context, tx *sql.Tx, batch int) (int, error) {
	rows, e := tx.QueryContext(ctx, `SELECT t.order_id FROM telegram_subscriptions t JOIN orders o ON o.id=t.order_id WHERE o.status IN ('completed','cancelled') AND o.closed_at<=now()-interval '7 days' ORDER BY o.closed_at LIMIT $1`, batch)
	if e != nil {
		return 0, e
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return 0, e
	}
	for _, id := range ids {
		entry, err := s.journalEntry(ctx, tx, "telegram_order", id, "erase", "retention")
		if err != nil {
			return 0, err
		}
		if e = eraseTelegram(ctx, tx, id); e != nil {
			return 0, e
		}
		if e = recordDestruction(ctx, tx, entry); e != nil {
			return 0, e
		}
	}
	return len(ids), nil
}
