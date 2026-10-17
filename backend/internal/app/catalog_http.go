package app

import (
	"net/http"

	"time"
)

func (a *API) menu(w http.ResponseWriter, r *http.Request) {
	p, e := a.Store.Products(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	s, e := a.Store.Settings(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	minutes, e := a.Store.EstimatedMinutes(r.Context(), s.PrepMinutes)
	if e != nil {
		fail(w, e)
		return
	}
	shop, e := a.Store.Shop(r.Context(), shopID(r.Context()))
	if e != nil {
		fail(w, e)
		return
	}
	open, message := shop.Intake(time.Now())
	var ready bool
	if e = a.Store.DB.QueryRowContext(r.Context(), "SELECT current_version IS NOT NULL FROM privacy_settings WHERE id=1").Scan(&ready); e != nil {
		fail(w, e)
		return
	}
	if !ready {
		open = false
		message = "Оператор ещё не опубликовал документы. Приём новых заказов недоступен."
	}
	if actor(r.Context()).ID == 0 {
		shop.StopReason = ""
	}
	reply(w, 200, map[string]any{"products": p, "settings": s, "accepting_orders": open, "intake_message": message, "estimated_minutes": minutes, "store": shop, "privacy_ready": ready})
}

func (a *API) saveProduct(w http.ResponseWriter, r *http.Request) {
	var p Product
	if !decode(w, r, &p) {
		return
	}
	if r.Method == "PUT" {
		id, ok := parseID(w, r)
		if !ok {
			return
		}
		p.ID = id
	} else {
		p.ID = 0
	}
	if e := p.Validate(); e != nil {
		fail(w, e)
		return
	}
	p, e := a.Store.SaveProduct(r.Context(), p)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, p)
}

func (a *API) deleteProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if e := a.Store.DeleteProduct(r.Context(), id); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}

func (a *API) saveSettings(w http.ResponseWriter, r *http.Request) {
	var s Settings
	if !decode(w, r, &s) {
		return
	}
	if e := s.Validate(); e != nil {
		fail(w, e)
		return
	}
	if e := a.Store.SaveSettings(r.Context(), s); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, s)
}
