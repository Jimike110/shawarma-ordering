package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TelegramConfig struct {
	Enabled                                              bool
	BotToken, BotUsername, WebhookSecret, DispatchSecret string
	// Client is injectable for isolated fake-Bot-API tests. Production always uses api.telegram.org.
	Client *http.Client
}

func loadTelegramConfig() TelegramConfig {
	return TelegramConfig{Enabled: os.Getenv("TELEGRAM_ENABLED") == "true", BotToken: os.Getenv("TELEGRAM_BOT_TOKEN"), BotUsername: os.Getenv("TELEGRAM_BOT_USERNAME"), WebhookSecret: os.Getenv("TELEGRAM_WEBHOOK_SECRET"), DispatchSecret: os.Getenv("TELEGRAM_DISPATCH_SECRET")}
}
func (c TelegramConfig) configured() bool {
	if !c.Enabled || c.BotToken == "" || len(c.WebhookSecret) < 32 || len(c.DispatchSecret) < 32 || len(c.BotUsername) < 5 || len(c.BotUsername) > 32 {
		return false
	}
	for _, r := range c.BotUsername {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}

type TelegramCheckout struct {
	IntentID string `json:"intent_id,omitempty"`
}
type telegramTokenKey struct{}

func telegramContext(ctx context.Context, r *http.Request) context.Context {
	return context.WithValue(ctx, telegramTokenKey{}, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
}
func (s *Store) telegramRecipient(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (int64, error) {
	token, _ := ctx.Value(telegramTokenKey{}).(string)
	if len(token) != 43 {
		return 0, problem(401, "Откройте приложение заново через Telegram.")
	}
	var id int64
	e := q.QueryRowContext(ctx, "SELECT recipient FROM telegram_sessions WHERE token_hash=$1 AND expires_at>now()", Hash(token)).Scan(&id)
	if e == sql.ErrNoRows {
		return 0, problem(401, "Откройте приложение заново через Telegram.")
	}
	return id, e
}

// Validate only Telegram's signed raw launch data; no profile is persisted.
func validateTelegramInit(raw, token string, now time.Time) (int64, time.Time, error) {
	bad := errors.New("invalid Telegram launch")
	if len(raw) == 0 || len(raw) > 16384 || token == "" {
		return 0, time.Time{}, bad
	}
	v, e := url.ParseQuery(raw)
	if e != nil {
		return 0, time.Time{}, bad
	}
	keys := []string{}
	for k, values := range v {
		if len(values) != 1 {
			return 0, time.Time{}, bad
		}
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	parts := []string{}
	for _, k := range keys {
		parts = append(parts, k+"="+v.Get(k))
	}
	key := hmac.New(sha256.New, []byte("WebAppData"))
	key.Write([]byte(token))
	mac := hmac.New(sha256.New, key.Sum(nil))
	mac.Write([]byte(strings.Join(parts, "\n")))
	supplied, e := hex.DecodeString(v.Get("hash"))
	if e != nil || !hmac.Equal(supplied, mac.Sum(nil)) {
		return 0, time.Time{}, bad
	}
	seconds, e := strconv.ParseInt(v.Get("auth_date"), 10, 64)
	date := time.Unix(seconds, 0)
	if e != nil || date.Before(now.Add(-time.Hour)) || date.After(now.Add(time.Minute)) {
		return 0, time.Time{}, bad
	}
	var user struct {
		ID int64 `json:"id"`
	}
	if json.Unmarshal([]byte(v.Get("user")), &user) != nil || user.ID < 1 {
		return 0, time.Time{}, bad
	}
	return user.ID, date, nil
}
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
func (a *API) telegramConfig(w http.ResponseWriter, r *http.Request) {
	ready, e := a.Store.telegramReady(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]any{"ready": ready, "bot_username": a.Config.Telegram.BotUsername})
}
func (a *API) telegramSession(w http.ResponseWriter, r *http.Request) {
	if !a.Store.Telegram.configured() {
		fail(w, problem(503, "Telegram пока не подключён. Закажите на сайте."))
		return
	}
	if !a.limit(w, r, "telegram-session", 30) {
		return
	}
	var in struct {
		InitData string `json:"init_data"`
	}
	if !decode(w, r, &in) {
		return
	}
	id, date, e := validateTelegramInit(in.InitData, a.Config.Telegram.BotToken, time.Now())
	if e != nil {
		fail(w, problem(401, "Откройте приложение заново через Telegram."))
		return
	}
	allowed, e := a.Store.Allow(r.Context(), "telegram-user:"+a.Store.privacyDigest("telegram-user", fmt.Sprint(id)), 60)
	if e != nil {
		fail(w, e)
		return
	}
	if !allowed {
		fail(w, problem(429, "Слишком много запросов. Попробуйте позже."))
		return
	}
	token := randomToken()
	expiry := time.Now().Add(30 * time.Minute)
	if bound := date.Add(time.Hour); expiry.After(bound) {
		expiry = bound
	}
	_, e = a.Store.DB.ExecContext(r.Context(), "INSERT INTO telegram_sessions(token_hash,recipient,expires_at) VALUES($1,$2,$3)", Hash(token), id, expiry)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 201, map[string]any{"token": token, "expires_at": expiry})
}
func (a *API) telegramIntent(w http.ResponseWriter, r *http.Request) {
	ready, e := a.Store.telegramReady(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	if !ready {
		fail(w, problem(409, "Документы Telegram не опубликованы. Обновите страницу."))
		return
	}
	if !a.limit(w, r, "telegram-intent", 30) {
		return
	}
	ctx := telegramContext(r.Context(), r)
	recipient, e := a.Store.telegramRecipient(ctx, a.Store.DB)
	if e != nil {
		fail(w, e)
		return
	}
	var in struct {
		RequestKey string `json:"request_key"`
		StoreID    int64  `json:"store_id"`
		Version    int64  `json:"consent_version"`
		Accepted   bool   `json:"accepted"`
	}
	if !decode(w, r, &in) {
		return
	}
	probe := Checkout{RequestKey: in.RequestKey, Items: []CartItem{{ProductID: 1, Quantity: 1, ExpectedPrice: 1}}}
	if probe.Validate() != nil || in.StoreID < 1 || !in.Accepted {
		fail(w, problem(400, "Подтвердите отдельное согласие на уведомления."))
		return
	}
	id := randomToken()
	result, e := a.Store.DB.ExecContext(ctx, `INSERT INTO telegram_intents(id,recipient,request_key,store_id,version_id)
 SELECT $1,$2,$3,s.id,p.id FROM stores s,privacy_versions p,privacy_settings ps
 WHERE s.id=$4 AND s.published AND NOT s.archived AND ps.id=1 AND p.id=ps.current_version AND p.id=$5
 AND p.telegram_consent<>'' AND (p.operator->>'telegram_notifications')::boolean=true`, id, recipient, in.RequestKey, in.StoreID, in.Version)
	if e != nil {
		fail(w, e)
		return
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		fail(w, problem(409, "Точка или версия согласия изменились. Обновите страницу."))
		return
	}
	reply(w, 201, map[string]string{"intent_id": id})
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
func (a *API) telegramOrder(w http.ResponseWriter, r *http.Request) {
	if !a.Store.Telegram.configured() {
		fail(w, ErrMissing)
		return
	}
	ctx := telegramContext(r.Context(), r)
	recipient, e := a.Store.telegramRecipient(ctx, a.Store.DB)
	if e != nil {
		fail(w, e)
		return
	}
	handle := r.PathValue("handle")
	if len(handle) != 43 {
		fail(w, ErrMissing)
		return
	}
	// Same response for another recipient, expired handle or unknown handle.
	var id int64
	e = a.Store.DB.QueryRowContext(ctx, `SELECT t.order_id FROM telegram_subscriptions t JOIN orders o ON o.id=t.order_id WHERE t.handle=$1 AND t.recipient=$2 AND (o.closed_at IS NULL OR o.closed_at>now()-interval '7 days')`, handle, recipient).Scan(&id)
	if e == sql.ErrNoRows {
		fail(w, problem(404, "Заказ недоступен или срок доступа через Telegram истёк."))
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "DELETE" {
		e = a.Store.eraseTelegramOrders(ctx, []int64{id}, "telegram_unsubscribe")
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, 200, map[string]bool{"ok": true})
		return
	}
	o, e := scanOrder(a.Store.DB.QueryRowContext(ctx, "SELECT "+orderCols+" FROM orders WHERE id=$1", id))
	if e != nil {
		fail(w, e)
		return
	}
	o.ID = 0
	o.Name = ""
	o.Note = ""
	o.CancelledBy = ""
	o.CancellationReason = ""
	o.Token = ""
	var delivery string
	e = a.Store.DB.QueryRowContext(ctx, "SELECT CASE WHEN count(*) FILTER (WHERE state='failed')>0 THEN 'failed' WHEN count(*) FILTER (WHERE state='pending')>0 THEN 'pending' ELSE 'sent' END FROM telegram_outbox WHERE order_id=$1", id).Scan(&delivery)
	if e != nil {
		fail(w, e)
		return
	}
	o.TelegramDelivery = delivery
	reply(w, 200, o)
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

func (a *API) telegramWebhook(w http.ResponseWriter, r *http.Request) {
	// Keep withdrawal/block handling available while sending/order intake is disabled.
	if len(a.Config.Telegram.WebhookSecret) < 32 || !hmac.Equal([]byte(r.Header.Get("X-Telegram-Bot-Api-Secret-Token")), []byte(a.Config.Telegram.WebhookSecret)) {
		fail(w, problem(403, "Недопустимый запрос."))
		return
	}
	var in struct {
		ID      int64 `json:"update_id"`
		Message *struct {
			Text string `json:"text"`
			Chat struct {
				ID   int64  `json:"id"`
				Type string `json:"type"`
			} `json:"chat"`
		} `json:"message"`
		Membership *struct {
			Chat struct {
				ID   int64  `json:"id"`
				Type string `json:"type"`
			} `json:"chat"`
			New struct {
				Status string `json:"status"`
			} `json:"new_chat_member"`
		} `json:"my_chat_member"`
	}
	// Telegram adds fields; accept known fields without persisting the full update.
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	if json.NewDecoder(r.Body).Decode(&in) != nil || in.ID < 1 {
		fail(w, problem(400, "Некорректное обновление."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(r.Context(), "SELECT pg_advisory_xact_lock(184020)"); e != nil {
		fail(w, e)
		return
	}
	res, e := tx.ExecContext(r.Context(), "INSERT INTO telegram_updates(id) VALUES($1) ON CONFLICT DO NOTHING", in.ID)
	if e != nil {
		fail(w, e)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		reply(w, 200, map[string]bool{"ok": true})
		return
	}
	var recipient int64
	if in.Message != nil && in.Message.Chat.Type == "private" {
		fields := strings.Fields(in.Message.Text)
		if len(fields) > 0 && strings.Split(fields[0], "@")[0] == "/stop" {
			recipient = in.Message.Chat.ID
		}
	}
	if in.Membership != nil && in.Membership.Chat.Type == "private" && in.Membership.New.Status == "kicked" {
		recipient = in.Membership.Chat.ID
	}
	if recipient > 0 {
		rows, err := tx.QueryContext(r.Context(), "SELECT order_id FROM telegram_subscriptions WHERE recipient=$1", recipient)
		if err != nil {
			fail(w, err)
			return
		}
		ids := []int64{}
		for rows.Next() {
			var id int64
			if err = rows.Scan(&id); err != nil {
				break
			}
			ids = append(ids, id)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			fail(w, err)
			return
		}
		for _, id := range ids {
			entry, err := a.Store.journalEntry(r.Context(), tx, "telegram_order", id, "erase", "telegram_stop")
			if err != nil {
				fail(w, err)
				return
			}
			if e = eraseTelegram(r.Context(), tx, id); e == nil {
				e = recordDestruction(r.Context(), tx, entry)
			}
			if e != nil {
				fail(w, e)
				return
			}
		}
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM telegram_sessions WHERE recipient=$1", recipient); e == nil {
			_, e = tx.ExecContext(r.Context(), "DELETE FROM telegram_intents WHERE recipient=$1", recipient)
		}
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	if a.Config.Telegram.Enabled && in.Message != nil && in.Message.Chat.Type == "private" && in.Message.Chat.ID > 0 {
		fields := strings.Fields(in.Message.Text)
		if len(fields) > 0 && strings.Split(fields[0], "@")[0] == "/start" {
			entry := a.Config.Origin + "/tg/"
			if len(fields) > 1 && strings.HasPrefix(fields[1], "s_") {
				id, err := strconv.ParseInt(strings.TrimPrefix(fields[1], "s_"), 10, 64)
				var slug string
				if err == nil && id > 0 && a.Store.DB.QueryRowContext(r.Context(), "SELECT slug FROM stores WHERE id=$1 AND published AND NOT archived", id).Scan(&slug) == nil {
					entry = a.Config.Origin + "/tg/s/" + url.PathEscape(slug)
				} else {
					entry = a.Config.Origin + "/tg/locations"
				}
			}
			reply(w, 200, map[string]any{"method": "sendMessage", "chat_id": in.Message.Chat.ID, "text": "Закажите заранее, заберите и оплатите на месте. Уведомления о конкретном заказе можно включить при оформлении; /stop отключает их.", "reply_markup": map[string]any{"inline_keyboard": [][]any{{map[string]any{"text": "Заказать", "web_app": map[string]string{"url": entry}}}}}})
			return
		}
	}
	reply(w, 200, map[string]bool{"ok": true})
}

func (a *API) telegramHealth(w http.ResponseWriter, r *http.Request) {
	var pending, failed int
	var oldest, last, lastSent *time.Time
	var code string
	e := a.Store.DB.QueryRowContext(r.Context(), `SELECT (SELECT count(*) FROM telegram_outbox WHERE state='pending'),(SELECT count(*) FROM telegram_outbox WHERE state='failed'),(SELECT min(created_at) FROM telegram_outbox WHERE state='pending'),last_dispatch,last_sent,error_code FROM telegram_health WHERE id=1`).Scan(&pending, &failed, &oldest, &last, &lastSent, &code)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]any{"configured": a.Store.Telegram.configured(), "pending": pending, "failed": failed, "oldest_pending_at": oldest, "last_dispatch_at": last, "last_sent_at": lastSent, "error_code": code})
}
func (a *API) telegramDispatch(w http.ResponseWriter, r *http.Request) {
	secret := a.Config.Telegram.DispatchSecret
	if len(secret) < 32 || !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) {
		fail(w, problem(403, "Недопустимый запрос."))
		return
	}
	n, e := a.DispatchTelegram(r.Context(), 10)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]int{"processed": n})
}

func (a *API) telegramSend(ctx context.Context, recipient int64, text, handle string) (int, time.Duration, error) {
	labels := map[string]any{"text": "Статус заказа", "web_app": map[string]string{"url": a.Config.Origin + "/tg/order/" + handle}}
	raw := mustJSON(map[string]any{"chat_id": recipient, "text": text, "reply_markup": map[string]any{"inline_keyboard": [][]any{{labels}}}})
	sendCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(sendCtx, "POST", "https://api.telegram.org/bot"+a.Config.Telegram.BotToken+"/sendMessage", strings.NewReader(string(raw)))
	if e != nil {
		return 0, 0, errors.New("telegram request configuration")
	}
	req.Header.Set("Content-Type", "application/json")
	client := a.Config.Telegram.Client
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	res, e := client.Do(req)
	if e != nil {
		return 0, 0, errors.New("telegram transport unavailable")
	}
	defer res.Body.Close()
	var out struct {
		OK         bool `json:"ok"`
		Code       int  `json:"error_code"`
		Parameters struct {
			Retry int `json:"retry_after"`
		} `json:"parameters"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&out) != nil {
		return res.StatusCode, 0, errors.New("telegram invalid response")
	}
	if out.OK && res.StatusCode == 200 {
		return 200, 0, nil
	}
	code := out.Code
	if code == 0 {
		code = res.StatusCode
	}
	return code, time.Duration(out.Parameters.Retry) * time.Second, errors.New("telegram delivery rejected")
}

// Jobs are claimed in short transactions; no database transaction spans a network send.
func (a *API) DispatchTelegram(ctx context.Context, batch int) (int, error) {
	if !a.Store.Telegram.configured() {
		return 0, nil
	}
	if batch < 1 || batch > 50 {
		return 0, errors.New("invalid dispatch batch")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	// One global lease bounds business-wide and per-chat rates across function instances.
	lease := randomToken()
	res, e := a.Store.DB.ExecContext(ctx, `UPDATE telegram_health SET last_dispatch=now(),lease=$1,lease_until=now()+interval '30 seconds' WHERE id=1 AND (lease_until IS NULL OR lease_until<now()) AND (last_dispatch IS NULL OR last_dispatch<now()-interval '1 second')`, lease)
	if e != nil {
		return 0, e
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return 0, nil
	}
	defer func() {
		release, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_, _ = a.Store.DB.ExecContext(release, "UPDATE telegram_health SET lease=NULL,lease_until=NULL,last_dispatch=now() WHERE id=1 AND lease=$1", lease)
	}()
	processed := 0
	for processed < batch && ctx.Err() == nil {
		var id, orderID, recipient, number int64
		var event, status, handle, address string
		var attempts int
		e = a.Store.DB.QueryRowContext(ctx, `WITH candidate AS (
 SELECT b.id FROM telegram_outbox b JOIN telegram_subscriptions t ON t.order_id=b.order_id JOIN orders o ON o.id=b.order_id
 WHERE b.state='pending' AND b.next_at<=now() AND (b.lease_until IS NULL OR b.lease_until<now())
 AND (o.closed_at IS NULL OR o.closed_at>now()-interval '7 days')
 AND NOT EXISTS(SELECT 1 FROM telegram_outbox busy JOIN telegram_subscriptions bt ON bt.order_id=busy.order_id WHERE bt.recipient=t.recipient AND busy.lease_until>now())
 ORDER BY b.id FOR UPDATE OF b SKIP LOCKED LIMIT 1)
 UPDATE telegram_outbox b SET lease=$1,lease_until=now()+interval '30 seconds',attempts=attempts+1 FROM candidate c WHERE b.id=c.id
 RETURNING b.id,b.order_id,b.event,b.attempts`, lease).Scan(&id, &orderID, &event, &attempts)
		if e == sql.ErrNoRows {
			break
		}
		if e != nil {
			return processed, e
		}
		e = a.Store.DB.QueryRowContext(ctx, `SELECT t.recipient,t.handle,o.number,o.status,COALESCE(o.shop->>'address','') FROM telegram_subscriptions t JOIN orders o ON o.id=t.order_id WHERE t.order_id=$1 AND (o.closed_at IS NULL OR o.closed_at>now()-interval '7 days')`, orderID).Scan(&recipient, &handle, &number, &status, &address)
		if e != nil && e != sql.ErrNoRows {
			return processed, e
		}
		obsolete := e == sql.ErrNoRows || status == "completed" || (status == "cancelled" && event != "cancelled") || (event == "ready" && status != "ready") || (event == "accepted" && status == "ready")
		if obsolete {
			_, e = a.Store.DB.ExecContext(ctx, "UPDATE telegram_outbox SET state='skipped',lease=NULL,lease_until=NULL WHERE id=$1 AND lease=$2", id, lease)
			if e != nil {
				return processed, e
			}
			processed++
			continue
		}
		label := map[string]string{"accepted": "Заказ принят", "ready": "Заказ готов — можно забирать", "cancelled": "Заказ отменён"}[event]
		code, retry, sendErr := a.telegramSend(ctx, recipient, fmt.Sprintf("Заказ №%d\n%s\n%s", number, address, label), handle)
		state := "sent"
		if sendErr != nil {
			state = "pending"
			if code >= 400 && code < 500 && code != 429 {
				state = "failed"
			}
			if attempts >= 12 {
				state = "failed"
			}
		}
		delay := time.Duration(1<<min(attempts-1, 8)) * time.Minute
		if retry > delay {
			delay = retry
		}
		_, e = a.Store.DB.ExecContext(ctx, `UPDATE telegram_outbox SET state=$1,next_at=now()+$2::interval,lease=NULL,lease_until=NULL,sent_at=CASE WHEN $1='sent' THEN now() END WHERE id=$3 AND lease=$4`, state, fmt.Sprintf("%f seconds", delay.Seconds()), id, lease)
		if e != nil {
			return processed, e
		}
		health := ""
		if sendErr != nil {
			health = fmt.Sprintf("delivery_%d", code)
		}
		_, e = a.Store.DB.ExecContext(ctx, "UPDATE telegram_health SET error_code=$1,last_sent=CASE WHEN $2 THEN now() ELSE last_sent END WHERE id=1", health, sendErr == nil)
		if e != nil {
			return processed, e
		}
		processed++
		if code == 403 {
			if e = a.Store.eraseTelegramRecipient(ctx, recipient, "telegram_blocked"); e != nil {
				return processed, e
			}
		}
		if code == 429 || code == 401 {
			break
		}
		if processed < batch {
			select {
			case <-ctx.Done():
				return processed, ctx.Err()
			case <-time.After(time.Second):
			}
		}
	}
	return processed, ctx.Err()
}
