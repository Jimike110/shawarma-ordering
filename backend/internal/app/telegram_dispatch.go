package app

import (
	"context"
	"net/http"
	"strings"

	"encoding/json"

	"database/sql"

	"io"
	"time"

	"errors"
	"fmt"
)

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
