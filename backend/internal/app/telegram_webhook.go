package app

import (
	"crypto/hmac"
	"net/http"

	"strconv"
	"strings"

	"encoding/json"
	"net/url"
)

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
