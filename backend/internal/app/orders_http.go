package app

import (
	"net/http"
)

func (a *API) createOrder(w http.ResponseWriter, r *http.Request) {
	var c Checkout
	if !decode(w, r, &c) {
		return
	}
	if e := c.Validate(); e != nil {
		fail(w, e)
		return
	}
	if !a.limit(w, r, "order", 30) {
		return
	}
	o, e := a.Store.CreateOrder(telegramContext(r.Context(), r), c, a.orderToken(c.RequestKey))
	if e != nil {
		fail(w, e)
		return
	}
	if c.Telegram != nil && c.Telegram.IntentID != "" {
		_, _ = a.DispatchTelegram(r.Context(), 1)
		_ = a.Store.DB.QueryRowContext(r.Context(), "SELECT handle FROM telegram_subscriptions WHERE order_id=$1", o.ID).Scan(&o.TelegramHandle)
	}
	reply(w, 201, o)
}

func (a *API) track(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if len(token) != 43 {
		fail(w, ErrMissing)
		return
	}
	o, e := a.Store.Track(r.Context(), token)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, o)
}

func (a *API) orders(w http.ResponseWriter, r *http.Request) {
	o, e := a.Store.Orders(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, o)
}

func (a *API) updateOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var u OrderUpdate
	if !decode(w, r, &u) {
		return
	}
	if e := ValidateUpdate(u); e != nil {
		fail(w, e)
		return
	}
	o, e := a.Store.UpdateOrder(r.Context(), id, u)
	if e != nil {
		fail(w, e)
		return
	}
	if u.Status == "ready" || u.Status == "cancelled" {
		_, _ = a.DispatchTelegram(r.Context(), 1)
	}
	reply(w, 200, o)
}
