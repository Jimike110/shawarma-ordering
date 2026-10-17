package app

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

func (s *Store) privacyDigest(purpose, value string) string {
	h := hmac.New(sha256.New, []byte(s.PrivacyKey))
	h.Write([]byte("privacy-v1:" + purpose + ":" + value))
	return hex.EncodeToString(h.Sum(nil))
}

// V1 signed wire layout is immutable. Future formats need a separate decoder;
// adding/reordering fields here would invalidate existing journal signatures.
type deletionEntry struct {
	ID        string    `json:"id"`
	Target    string    `json:"target"`
	TargetID  int64     `json:"target_id"`
	Operation string    `json:"operation"`
	Reason    string    `json:"reason"`
	At        time.Time `json:"at"`
	ActorID   int64     `json:"actor_id"`
	MAC       string    `json:"mac"`
}

func (s *Store) journalEntry(ctx context.Context, tx *sql.Tx, target string, id int64, operation, reason string) (deletionEntry, error) {
	entry := deletionEntry{Target: target, TargetID: id, Operation: operation, Reason: reason, At: time.Now().UTC(), ActorID: actor(ctx).ID}
	if len(s.PrivacyKey) < 32 || s.JournalPath == "" {
		return entry, problem(503, "Журнал удаления не настроен. Настройте защищённый внешний PRIVACY_JOURNAL_PATH и стабильный SESSION_SECRET.")
	}
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		return entry, e
	}
	entry.ID = hex.EncodeToString(b)
	raw, _ := json.Marshal(entry)
	entry.MAC = s.privacyDigest("journal", string(raw))
	raw, _ = json.Marshal(entry)
	if !filepath.IsAbs(s.JournalPath) {
		return entry, errors.New("PRIVACY_JOURNAL_PATH must be absolute and outside database snapshots")
	}
	f, e := os.OpenFile(s.JournalPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0600)
	if e != nil {
		return entry, e
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return entry, err
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		f.Close()
		return entry, errors.New("journal file permissions must be 0600")
	}
	if info.Size() > 0 {
		var last [1]byte
		if _, err = f.ReadAt(last[:], info.Size()-1); err != nil || last[0] != '\n' {
			f.Close()
			return entry, errors.New("incomplete deletion journal; repair before deleting data")
		}
	}
	// Durable intention precedes commit. A rolled-back intention is replayed as erasure,
	// never resurrection. All writers hold the same database advisory lock.
	_, e = f.Write(append(raw, '\n'))
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e == nil {
		e = closeErr
	}
	if e == nil {
		e = syncJournalDir(s.JournalPath)
	}
	return entry, e
}
func syncJournalDir(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	d, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}
func recordDestruction(ctx context.Context, tx *sql.Tx, e deletionEntry) error {
	var actorID any
	if e.ActorID > 0 {
		var exists bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM staff_accounts WHERE id=$1)", e.ActorID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			actorID = e.ActorID
		}
	}
	categories := "Имя, комментарий, свободный текст отмены"
	if e.Operation == "expire" {
		categories = "Индивидуальная квитанция, состав, стоимость, события, связь с личной ссылкой и исходным ключом повтора"
	}
	if e.Target == "staff" {
		categories = "Логин, отображаемое имя, телефон, email, хеш пароля отключённого сотрудника"
	}
	if e.Target == "telegram_order" {
		categories = "Связь заказа с Telegram, идентификатор получателя, доступ и очередь уведомлений"
	}
	if e.Operation == "block" {
		categories = "Блокирование необязательных полей; не подтверждение уничтожения"
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO privacy_destructions(event_id,target_kind,target_id,operation,categories,reason,executed_at,actor_id,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7::timestamptz+interval '3 years') ON CONFLICT DO NOTHING`, e.ID, e.Target, e.TargetID, e.Operation, categories, e.Reason, e.At, actorID)
	return err
}
func erasePersonal(ctx context.Context, tx *sql.Tx, id int64) error {
	_, e := tx.ExecContext(ctx, "UPDATE orders SET customer_name='',note='',cancellation_reason='',personal_erased_at=COALESCE(personal_erased_at,now()),personal_blocked=false WHERE id=$1", id)
	if e == nil {
		_, e = tx.ExecContext(ctx, "UPDATE audit_events SET details='{}' WHERE action='order.update' AND resource=$1", fmt.Sprint(id))
	}
	if e == nil {
		e = eraseTelegram(ctx, tx, id)
	}
	return e
}
func eraseAccount(ctx context.Context, tx *sql.Tx, id int64) error {
	var username string
	e := tx.QueryRowContext(ctx, "SELECT username FROM staff_accounts WHERE id=$1 AND NOT active FOR UPDATE", id).Scan(&username)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "UPDATE staff_accounts SET username='~removed:'||id,display_name='Удалённый сотрудник',phone='',email='',password_hash='!',password_required=true,contacts_erased_at=now(),version=version+1 WHERE id=$1", id)
	if e == nil {
		_, e = tx.ExecContext(ctx, "UPDATE audit_events SET staff_name='Удалённый сотрудник',details='{}' WHERE actor_id=$1 OR staff_name=$2", id, username)
	}
	if e == nil {
		_, e = tx.ExecContext(ctx, "UPDATE audit_events SET details='{}' WHERE action='account.save' AND resource=$1", fmt.Sprint(id))
	}
	if e == nil {
		_, e = tx.ExecContext(ctx, "UPDATE orders SET cancelled_by='Удалённый сотрудник' WHERE cancelled_by=$1", username)
	}
	if e == nil {
		_, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id)
	}
	return e
}

// ReplayPrivacyJournal runs against a restored database before serving traffic.
// Supply the live journal, never a file recovered from a database snapshot.
func (s *Store) ReplayPrivacyJournal(ctx context.Context) (int, error) {
	if len(s.PrivacyKey) < 32 || s.JournalPath == "" {
		return 0, errors.New("privacy key and external journal required")
	}
	f, e := os.Open(s.JournalPath)
	if e != nil {
		return 0, e
	}
	defer f.Close()
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184020)"); e != nil {
		return 0, e
	}
	scanner := bufio.NewScanner(f)
	count := 0
	for scanner.Scan() {
		var entry deletionEntry
		if e = json.Unmarshal(scanner.Bytes(), &entry); e != nil {
			return 0, errors.New("invalid deletion journal; restore must remain offline")
		}
		mac := entry.MAC
		entry.MAC = ""
		raw, _ := json.Marshal(entry)
		if !hmac.Equal([]byte(mac), []byte(s.privacyDigest("journal", string(raw)))) {
			return 0, errors.New("deletion journal authentication failed")
		}
		entry.MAC = mac
		var applied bool
		if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM privacy_destructions WHERE event_id=$1)", entry.ID).Scan(&applied); e != nil {
			return 0, e
		}
		if applied {
			continue
		}
		switch {
		case entry.Target == "order" && entry.Operation == "expire":
			e = s.archiveReceipt(ctx, tx, entry.TargetID)
		case entry.Target == "order" && entry.Operation == "block":
			_, e = tx.ExecContext(ctx, "UPDATE orders SET personal_blocked=true WHERE id=$1", entry.TargetID)
		case entry.Target == "order" && entry.Operation == "erase":
			e = erasePersonal(ctx, tx, entry.TargetID)
		case entry.Target == "staff" && entry.Operation == "erase":
			e = eraseAccount(ctx, tx, entry.TargetID)
		case entry.Target == "telegram_order" && entry.Operation == "erase":
			e = eraseTelegram(ctx, tx, entry.TargetID)
		default:
			return 0, errors.New("unsupported deletion journal operation")
		}
		if e != nil {
			return 0, e
		}
		if e = recordDestruction(ctx, tx, entry); e != nil {
			return 0, e
		}
		count++
	}
	if e = scanner.Err(); e != nil {
		return 0, e
	}
	return count, tx.Commit()
}

// Discard only intentions older than the approved three-year evidence period.
// At most one writer/compactor/replay holds the DB-wide lock. Restricted backup copies
// must expire in 14 days, so they never need entries this old.
func (s *Store) CompactPrivacyJournal(ctx context.Context) error {
	if len(s.PrivacyKey) < 32 || s.JournalPath == "" {
		return errors.New("privacy key and external journal required")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184020)"); e != nil {
		return e
	}
	f, e := os.Open(s.JournalPath)
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	if e != nil {
		return e
	}
	tmp, e := os.CreateTemp(filepath.Dir(s.JournalPath), ".privacy-journal-*")
	if e != nil {
		f.Close()
		return e
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	scanner := bufio.NewScanner(f)
	cutoff := time.Now().UTC().AddDate(-3, 0, 0)
	for scanner.Scan() {
		var entry deletionEntry
		if e = json.Unmarshal(scanner.Bytes(), &entry); e != nil {
			break
		}
		mac := entry.MAC
		entry.MAC = ""
		raw, _ := json.Marshal(entry)
		if !hmac.Equal([]byte(mac), []byte(s.privacyDigest("journal", string(raw)))) {
			e = errors.New("deletion journal authentication failed")
			break
		}
		if !entry.At.Before(cutoff) {
			if _, e = tmp.Write(append(append([]byte{}, scanner.Bytes()...), '\n')); e != nil {
				break
			}
		}
	}
	if e == nil {
		e = scanner.Err()
	}
	f.Close()
	if e != nil {
		return e
	}
	if e = tmp.Sync(); e != nil {
		return e
	}
	if e = tmp.Close(); e != nil {
		return e
	}
	if e = os.Rename(tmp.Name(), s.JournalPath); e != nil {
		return e
	}
	if e = syncJournalDir(s.JournalPath); e != nil {
		return e
	}
	return tx.Commit()
}
