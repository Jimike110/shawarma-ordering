package app

import (
	"database/sql"

	"context"
)

func (s *Store) telegramDocument(ctx context.Context) (*PrivacyDocument, error) {
	return scanPrivacy(s.DB.QueryRowContext(ctx, "SELECT "+privacyCols+" FROM privacy_versions WHERE id=(SELECT current_version FROM privacy_settings WHERE id=1)"))
}

func (s *Store) telegramReady(ctx context.Context) (bool, error) {
	if !s.Telegram.configured() || s.JournalPath == "" || len(s.PrivacyKey) < 32 {
		return false, nil
	}
	d, e := s.telegramDocument(ctx)
	return d != nil && d.Operator.Telegram && d.TelegramConsent != "", e
}

func (s *Store) checkTelegramCheckout(ctx context.Context, tx *sql.Tx, c Checkout) error {
	if c.Telegram == nil {
		return nil
	}
	if !s.Telegram.configured() || s.JournalPath == "" || len(s.PrivacyKey) < 32 {
		return problem(409, "Telegram пока не подключён. Откройте обычный сайт.")
	}
	var ready bool
	if e := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM privacy_versions p JOIN privacy_settings ps ON ps.current_version=p.id WHERE ps.id=1 AND p.telegram_consent<>'' AND (p.operator->>'telegram_notifications')::boolean=true)`).Scan(&ready); e != nil {
		return e
	}
	if !ready {
		return problem(409, "Документы Telegram ещё не опубликованы.")
	}
	if c.Telegram.IntentID == "" {
		return nil
	}
	recipient, e := s.telegramRecipient(ctx, tx)
	if e != nil {
		return e
	}
	var valid bool
	e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM telegram_intents i JOIN privacy_settings ps ON ps.current_version=i.version_id WHERE i.id=$1 AND i.recipient=$2 AND i.store_id=$3 AND i.request_key=$4 AND NOT i.used AND i.expires_at>now())`, c.Telegram.IntentID, recipient, c.StoreID, c.RequestKey).Scan(&valid)
	if e != nil {
		return e
	}
	if !valid {
		return problem(409, "Согласие или время отправки изменились. Подтвердите уведомления ещё раз.")
	}
	return nil
}

func (s *Store) attachTelegram(ctx context.Context, tx *sql.Tx, c Checkout, id int64) error {
	if c.Telegram == nil || c.Telegram.IntentID == "" {
		return nil
	}
	var recipient, version int64
	e := tx.QueryRowContext(ctx, "UPDATE telegram_intents SET used=true WHERE id=$1 AND NOT used RETURNING recipient,version_id", c.Telegram.IntentID).Scan(&recipient, &version)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO telegram_subscriptions(order_id,recipient,handle,version_id) VALUES($1,$2,$3,$4)", id, recipient, randomToken(), version)
	if e == nil {
		_, e = tx.ExecContext(ctx, "INSERT INTO privacy_evidence(order_ref,purpose,version_id,accepted) VALUES($1,'telegram_order_alerts',$2,true)", id, version)
	}
	if e == nil {
		e = enqueueTelegram(ctx, tx, id, "accepted")
	}
	return e
}

func enqueueTelegram(ctx context.Context, tx *sql.Tx, id int64, event string) error {
	if event != "accepted" && event != "ready" && event != "cancelled" {
		return nil
	}
	_, e := tx.ExecContext(ctx, "INSERT INTO telegram_outbox(order_id,event) SELECT order_id,$2 FROM telegram_subscriptions WHERE order_id=$1 ON CONFLICT DO NOTHING", id, event)
	return e
}

// A recipient never appears in the journal: its replay target is the order ID.
func eraseTelegram(ctx context.Context, tx *sql.Tx, id int64) error {
	_, e := tx.ExecContext(ctx, `DELETE FROM telegram_sessions WHERE recipient IN (SELECT recipient FROM telegram_subscriptions WHERE order_id=$1)`, id)
	if e == nil {
		_, e = tx.ExecContext(ctx, `DELETE FROM telegram_intents WHERE recipient IN (SELECT recipient FROM telegram_subscriptions WHERE order_id=$1)`, id)
	}
	if e == nil {
		_, e = tx.ExecContext(ctx, "DELETE FROM telegram_subscriptions WHERE order_id=$1", id)
	}
	return e
}

func (s *Store) eraseTelegramOrders(ctx context.Context, ids []int64, reason string) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184020)"); e != nil {
		return e
	}
	for _, id := range ids {
		entry, err := s.journalEntry(ctx, tx, "telegram_order", id, "erase", reason)
		if err != nil {
			return err
		}
		if e = eraseTelegram(ctx, tx, id); e != nil {
			return e
		}
		if e = recordDestruction(ctx, tx, entry); e != nil {
			return e
		}
	}
	return tx.Commit()
}
