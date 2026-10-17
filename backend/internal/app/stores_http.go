package app

import (
	"net/http"
	"strings"

	"database/sql"
	"encoding/json"

	"fmt"
	"regexp"
)

func (a *API) publicShops(w http.ResponseWriter, r *http.Request) {
	p, e := a.Store.Shops(r.Context(), true)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, p)
}

func (a *API) staffShops(w http.ResponseWriter, r *http.Request) {
	p, e := a.Store.Shops(r.Context(), false)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, p)
}

func (a *API) storeMenu(w http.ResponseWriter, r *http.Request) {
	var id int64
	e := a.Store.DB.QueryRowContext(r.Context(), "SELECT id FROM stores WHERE slug=$1 AND published AND NOT archived", r.PathValue("slug")).Scan(&id)
	if e == sql.ErrNoRows {
		fail(w, ErrMissing)
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	a.menu(w, r.WithContext(shopContext(r.Context(), id)))
}

func (a *API) createShop(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Slug    string `json:"slug"`
		Name    string `json:"name"`
		Address string `json:"address"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,59}$`).MatchString(input.Slug) || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Address) == "" || len(input.Name) > 200 || len(input.Address) > 400 {
		fail(w, problem(400, "Укажите название, адрес и короткий адрес ссылки латиницей."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var exists bool
	if e = tx.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM stores WHERE slug=$1)", input.Slug).Scan(&exists); e != nil {
		fail(w, e)
		return
	}
	if exists {
		fail(w, problem(409, "Адрес ссылки уже используется."))
		return
	}
	var id int64
	e = tx.QueryRowContext(r.Context(), "INSERT INTO stores(slug) VALUES($1) RETURNING id", input.Slug).Scan(&id)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO settings(id,shop_name,address,city,demo_mode) VALUES($1,$2,$3,'Санкт-Петербург',false)", id, input.Name, input.Address)
	}
	if e == nil {
		e = audit(shopContext(r.Context(), id), tx, "store.create", fmt.Sprint(id))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	p, e := a.Store.Shop(r.Context(), id)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 201, p)
}

func (a *API) storeLifecycle(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var in struct {
		Published    *bool  `json:"published"`
		Archived     *bool  `json:"archived"`
		OwnerStopped *bool  `json:"owner_stopped"`
		Reason       string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Reason) > 600 || (in.OwnerStopped != nil && *in.OwnerStopped && strings.TrimSpace(in.Reason) == "") {
		fail(w, problem(400, "Укажите причину остановки."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var p Shop
	e = tx.QueryRowContext(r.Context(), "SELECT published,archived,owner_stopped,stop_reason FROM stores WHERE id=$1 FOR UPDATE", id).Scan(&p.Published, &p.Archived, &p.OwnerStopped, &p.StopReason)
	if e == sql.ErrNoRows {
		fail(w, ErrMissing)
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	// Checkout locks the same store row before intake checks.
	if in.Archived != nil && *in.Archived {
		var active int
		e = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing','ready')", id).Scan(&active)
		if e != nil {
			fail(w, e)
			return
		}
		if active > 0 {
			fail(w, problem(409, "Сначала завершите активные заказы."))
			return
		}
	}
	if in.Published != nil {
		p.Published = *in.Published
	}
	if in.Archived != nil {
		p.Archived = *in.Archived
	}
	if in.OwnerStopped != nil {
		p.OwnerStopped = *in.OwnerStopped
		p.StopReason = strings.TrimSpace(in.Reason)
	}
	if p.Archived {
		p.Published = false
	}
	_, e = tx.ExecContext(r.Context(), "UPDATE stores SET published=$1,archived=$2,owner_stopped=$3,stop_reason=$4 WHERE id=$5", p.Published, p.Archived, p.OwnerStopped, p.StopReason, id)
	details, _ := json.Marshal(in)
	if e == nil {
		e = auditDetails(shopContext(r.Context(), id), tx, "store.status", fmt.Sprint(id), details)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	p, e = a.Store.Shop(r.Context(), id)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, p)
}

func (a *API) operational(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Paused      *bool  `json:"paused"`
		PrepMinutes *int   `json:"prep_minutes"`
		Reason      string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if (in.PrepMinutes != nil && (*in.PrepMinutes < 1 || *in.PrepMinutes > 120)) || len(in.Reason) > 600 || (in.Paused != nil && *in.Paused && strings.TrimSpace(in.Reason) == "") {
		fail(w, problem(400, "Проверьте время и причину паузы."))
		return
	}
	id := shopID(r.Context())
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var stopped bool
	e = tx.QueryRowContext(r.Context(), "SELECT owner_stopped FROM stores WHERE id=$1 FOR UPDATE", id).Scan(&stopped)
	if e == sql.ErrNoRows {
		fail(w, ErrMissing)
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	if stopped && in.Paused != nil && !*in.Paused {
		fail(w, problem(403, "Точка остановлена владельцем. Возобновить приём может только владелец."))
		return
	}
	_, e = tx.ExecContext(r.Context(), "UPDATE settings SET paused=COALESCE($1,paused),prep_minutes=COALESCE($2,prep_minutes) WHERE id=$3", in.Paused, in.PrepMinutes, id)
	details, _ := json.Marshal(in)
	if e == nil {
		e = auditDetails(r.Context(), tx, "store.operations", fmt.Sprint(id), details)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	a.menu(w, r)
}

func (a *API) availability(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var in struct {
		Available *bool `json:"available"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Available == nil {
		fail(w, problem(400, "Укажите доступность товара."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(r.Context(), "SELECT id FROM stores WHERE id=$1 FOR UPDATE", shopID(r.Context())); e != nil {
		fail(w, e)
		return
	}
	res, e := tx.ExecContext(r.Context(), "UPDATE products SET available=$1 WHERE id=$2 AND store_id=$3", *in.Available, id, shopID(r.Context()))
	if e != nil {
		fail(w, e)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		fail(w, ErrMissing)
		return
	}
	var toppingID int64
	if e = tx.QueryRowContext(r.Context(), "SELECT COALESCE(topping_id,0) FROM products WHERE id=$1 AND store_id=$2", id, shopID(r.Context())).Scan(&toppingID); e != nil {
		fail(w, e)
		return
	}
	if toppingID != 0 {
		if e = setToppingAvailable(r.Context(), tx, toppingID, shopID(r.Context()), *in.Available); e != nil {
			fail(w, e)
			return
		}
	}
	details, _ := json.Marshal(in)
	if e = auditDetails(r.Context(), tx, "product.availability", fmt.Sprint(id), details); e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, in)
}
