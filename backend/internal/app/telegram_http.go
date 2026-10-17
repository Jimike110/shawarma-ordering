package app

import (
	"net/http"

	"crypto/hmac"

	"database/sql"
	"fmt"
	"time"
)

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
