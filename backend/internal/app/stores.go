package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Shop struct {
	ID             int64          `json:"id"`
	Slug           string         `json:"slug"`
	Published      bool           `json:"published"`
	Archived       bool           `json:"archived"`
	OwnerStopped   bool           `json:"owner_stopped"`
	StopReason     string         `json:"stop_reason"`
	Settings       Settings       `json:"settings"`
	Role           string         `json:"role,omitempty"`
	Accepting      bool           `json:"accepting_orders"`
	Message        string         `json:"intake_message"`
	Counts         map[string]int `json:"counts,omitempty"`
	IntakeBlockers []string       `json:"intake_blockers"`
}

func (s *Store) Shop(ctx context.Context, id int64) (Shop, error) {
	var p Shop
	e := s.DB.QueryRowContext(ctx, "SELECT id,slug,published,archived,owner_stopped,stop_reason FROM stores WHERE id=$1", id).Scan(&p.ID, &p.Slug, &p.Published, &p.Archived, &p.OwnerStopped, &p.StopReason)
	if e == sql.ErrNoRows {
		return p, ErrMissing
	}
	if e != nil {
		return p, e
	}
	p.Settings, e = s.Settings(shopContext(ctx, id))
	if e != nil {
		return p, e
	}
	now := time.Now()
	p.Accepting, p.Message = p.Intake(now)
	var privacyReady bool
	if e = s.DB.QueryRowContext(ctx, "SELECT current_version IS NOT NULL FROM privacy_settings WHERE id=1").Scan(&privacyReady); e != nil {
		return p, e
	}
	if !privacyReady {
		p.Accepting = false
		p.Message = "Оператор ещё не опубликовал документы. Приём новых заказов недоступен."
	}
	p.IntakeBlockers = p.Blockers(now, privacyReady)
	return p, nil
}

// Blockers explain every independent intake condition without changing enforcement.
func (s Shop) Blockers(now time.Time, privacyReady bool) []string {
	out := []string{}
	if s.Archived {
		out = append(out, "archived")
	}
	if !s.Published {
		out = append(out, "unpublished")
	}
	if !privacyReady {
		out = append(out, "privacy_unpublished")
	}
	if s.OwnerStopped {
		out = append(out, "owner_stopped")
	}
	if s.Settings.Paused {
		out = append(out, "paused")
	}
	schedule := s.Settings
	schedule.Paused = false
	if open, _ := schedule.Intake(now); !open {
		out = append(out, "outside_hours")
	}
	return out
}
func (s Shop) Intake(now time.Time) (bool, string) {
	if s.Archived || !s.Published {
		return false, "Точка пока не принимает заказы."
	}
	if s.OwnerStopped {
		return false, "Приём заказов остановлен владельцем."
	}
	return s.Settings.Intake(now)
}
func (s *Store) Shops(ctx context.Context, public bool) ([]Shop, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT id FROM stores WHERE NOT $1 OR (published AND NOT archived) ORDER BY id", public)
	if e != nil {
		return nil, e
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return nil, e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	out := []Shop{}
	for _, id := range ids {
		if !public && actor(ctx).Role(id) == "" {
			continue
		}
		p, e := s.Shop(ctx, id)
		if e != nil {
			return nil, e
		}
		if public {
			p.StopReason = ""
		}
		if !public {
			p.Role = actor(ctx).Role(id)
			p.Counts = map[string]int{}
			r, e := s.DB.QueryContext(ctx, "SELECT status,count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing','ready') GROUP BY status", id)
			if e != nil {
				return nil, e
			}
			for r.Next() {
				var status string
				var count int
				if e = r.Scan(&status, &count); e != nil {
					r.Close()
					return nil, e
				}
				p.Counts[status] = count
			}
			e = r.Err()
			r.Close()
			if e != nil {
				return nil, e
			}
			var late int
			if e = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing') AND estimated_ready_at<now()", id).Scan(&late); e != nil {
				return nil, e
			}
			p.Counts["overdue"] = late
		}
		out = append(out, p)
	}
	return out, nil
}
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
func auditDetails(ctx context.Context, tx *sql.Tx, action, resource string, details []byte) error {
	u := actor(ctx)
	name, _ := ctx.Value(staffContextKey{}).(string)
	if name == "" {
		name = "system"
	}
	var aid, sid, did any
	if u.DeviceID > 0 {
		did = u.DeviceID
	}
	if u.ID > 0 {
		aid = u.ID
	}
	if id, ok := ctx.Value(storeKey{}).(int64); ok {
		sid = id
	}
	_, e := tx.ExecContext(ctx, "INSERT INTO audit_events(staff_name,actor_id,store_id,action,resource,details,device_id) VALUES($1,$2,$3,$4,$5,$6,$7)", name, aid, sid, action, resource, details, did)
	return e
}

type Activity struct {
	DeviceID    *int64          `json:"device_id,omitempty"`
	DeviceLabel string          `json:"device_label,omitempty"`
	ID          int64           `json:"id"`
	Actor       string          `json:"actor"`
	StoreID     *int64          `json:"store_id"`
	Action      string          `json:"action"`
	Resource    string          `json:"resource"`
	Details     json.RawMessage `json:"details"`
	At          time.Time       `json:"created_at"`
}

// Only owner endpoints accept a reporting filter. Scoped requests keep the
// already-authorized context, even when a caller supplies a forged query value.
func (a *API) reportStore(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if id, scoped := r.Context().Value(storeKey{}).(int64); scoped && id != 0 {
		return id, true
	}
	value := r.URL.Query().Get("store_id")
	if value == "" {
		return 0, true
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id < 1 {
		fail(w, problem(400, "Проверьте точку."))
		return 0, false
	}
	var exists bool
	if err = a.Store.DB.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM stores WHERE id=$1)", id).Scan(&exists); err != nil {
		fail(w, err)
		return 0, false
	}
	if !exists {
		fail(w, ErrMissing)
		return 0, false
	}
	return id, true
}

func (a *API) activity(w http.ResponseWriter, r *http.Request) {
	id, ok := a.reportStore(w, r)
	if !ok {
		return
	}
	before := int64(0)
	if v := r.URL.Query().Get("before"); v != "" {
		var e error
		before, e = strconv.ParseInt(v, 10, 64)
		if e != nil || before < 1 {
			fail(w, problem(400, "Некорректная страница."))
			return
		}
	}
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT id,staff_name,store_id,action,resource,details,created_at,device_id,COALESCE((SELECT label FROM kitchen_devices WHERE id=audit_events.device_id),'') FROM audit_events WHERE ($1::bigint=0 OR store_id=$1) AND ($2::bigint=0 OR id<$2) ORDER BY id DESC LIMIT 100", id, before)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var v Activity
		if e = rows.Scan(&v.ID, &v.Actor, &v.StoreID, &v.Action, &v.Resource, &v.Details, &v.At, &v.DeviceID, &v.DeviceLabel); e != nil {
			fail(w, e)
			return
		}
		out = append(out, v)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, out)
}
func (a *API) copyMenu(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Source      int64   `json:"source_store_id"`
		Destination int64   `json:"destination_store_id"`
		Products    []int64 `json:"product_ids"`
		Key         string  `json:"request_key"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Source < 1 || in.Destination < 1 || in.Source == in.Destination || len(in.Products) < 1 || len(in.Products) > 100 || !regexp.MustCompile(`^[a-zA-Z0-9-]{32,80}$`).MatchString(in.Key) {
		fail(w, problem(400, "Выберите товары, исходную и целевую точки."))
		return
	}
	seen := map[int64]bool{}
	for _, id := range in.Products {
		if id < 1 || seen[id] {
			fail(w, problem(400, "Проверьте список товаров."))
			return
		}
		seen[id] = true
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(r.Context(), "SELECT pg_advisory_xact_lock(184016)"); e != nil {
		fail(w, e)
		return
	}
	raw, _ := json.Marshal(in)
	hash := Hash(string(raw))
	var previous string
	var result []byte
	e = tx.QueryRowContext(r.Context(), "SELECT request_hash,result FROM menu_copies WHERE request_key=$1", in.Key).Scan(&previous, &result)
	if e == nil {
		if previous != hash {
			fail(w, problem(409, "Ключ копирования уже использован."))
			return
		}
		reply(w, 200, json.RawMessage(result))
		return
	}
	if e != sql.ErrNoRows {
		fail(w, e)
		return
	}
	// Deterministic lock ordering also serializes menu edits with the snapshot.
	for _, id := range []int64{min(in.Source, in.Destination), max(in.Source, in.Destination)} {
		var archived bool
		e = tx.QueryRowContext(r.Context(), "SELECT archived FROM stores WHERE id=$1 FOR UPDATE", id).Scan(&archived)
		if e == sql.ErrNoRows || archived {
			fail(w, problem(409, "Точка недоступна."))
			return
		}
		if e != nil {
			fail(w, e)
			return
		}
	}
	copied := []Product{}
	productMapping := map[int64]int64{}
	sourceProducts := []Product{}
	for _, id := range in.Products {
		p, e := scanProduct(tx.QueryRowContext(r.Context(), "SELECT "+productCols+" FROM products WHERE id=$1 AND store_id=$2", id, in.Source))
		if e == sql.ErrNoRows {
			fail(w, ErrMissing)
			return
		}
		if e != nil {
			fail(w, e)
			return
		}
		sourceProducts = append(sourceProducts, p)
		legacy := []ProductOption{}
		for _, o := range p.Options {
			if o.ToppingID == 0 {
				legacy = append(legacy, o)
			}
		}
		p.Options = legacy
		p.ToppingID = 0
		options, _ := json.Marshal(p.Options)
		e = tx.QueryRowContext(r.Context(), "INSERT INTO products(name,description,price,image,weight,category,available,sort_order,ingredients,allergens,options,store_id) VALUES($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11) RETURNING id", p.Name, p.Description, p.Price, p.Image, p.Weight, p.Category, p.SortOrder, p.Ingredients, p.Allergens, options, in.Destination).Scan(&p.ID)
		if e != nil {
			fail(w, e)
			return
		}
		p.Available = false
		productMapping[id] = p.ID
		copied = append(copied, p)
	}
	copied, e = copyToppings(r.Context(), tx, in.Source, in.Destination, sourceProducts, productMapping, copied)
	if e != nil {
		fail(w, e)
		return
	}
	result, _ = json.Marshal(copied)
	_, e = tx.ExecContext(r.Context(), "INSERT INTO menu_copies VALUES($1,$2,$3,now())", in.Key, hash, result)
	details, _ := json.Marshal(map[string]any{"source_store_id": in.Source, "count": len(copied)})
	if e == nil {
		e = auditDetails(shopContext(r.Context(), in.Destination), tx, "menu.copy", fmt.Sprint(in.Destination), details)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, copied)
}

type Analytics struct {
	From            string          `json:"from"`
	To              string          `json:"to"`
	StoreID         int64           `json:"store_id"`
	Orders          int             `json:"orders"`
	Statuses        map[string]int  `json:"statuses"`
	CompletedValue  int64           `json:"completed_value"`
	AverageBasket   float64         `json:"average_basket"`
	PrepMinutes     float64         `json:"preparation_minutes"`
	PrepSamples     int             `json:"preparation_samples"`
	ReadyMinutes    float64         `json:"ready_minutes"`
	ReadySamples    int             `json:"ready_samples"`
	Late            int             `json:"late_ready"`
	DeadlineSamples int             `json:"deadline_samples"`
	Daily           []DailyMetric   `json:"daily"`
	Products        []ProductMetric `json:"products"`
	Stores          []StoreMetric   `json:"stores"`
}
type DailyMetric struct {
	Date   string `json:"date"`
	Orders int    `json:"orders"`
	Value  int64  `json:"completed_value"`
}
type ProductMetric struct {
	Name     string `json:"name"`
	Quantity int    `json:"quantity"`
	Value    int64  `json:"value"`
}
type StoreMetric struct {
	StoreID     int64   `json:"store_id"`
	Orders      int     `json:"orders"`
	Value       int64   `json:"completed_value"`
	PrepMinutes float64 `json:"preparation_minutes"`
	Samples     int     `json:"preparation_samples"`
}

func (a *API) analytics(w http.ResponseWriter, r *http.Request) {
	zone := time.FixedZone("MSK", 10800)
	today := time.Now().In(zone).Format("2006-01-02")
	to := r.URL.Query().Get("to")
	if to == "" {
		to = today
	}
	end, e := time.ParseInLocation("2006-01-02", to, zone)
	if e != nil {
		fail(w, problem(400, "Проверьте даты."))
		return
	}
	from := r.URL.Query().Get("from")
	if from == "" {
		from = end.AddDate(0, 0, -6).Format("2006-01-02")
	}
	start, e := time.ParseInLocation("2006-01-02", from, zone)
	if e != nil || start.After(end) || end.Sub(start) > 365*24*time.Hour {
		fail(w, problem(400, "Период: не более одного года."))
		return
	}
	end = end.AddDate(0, 0, 1)
	id, ok := a.reportStore(w, r)
	if !ok {
		return
	}
	report := Analytics{From: from, To: to, StoreID: id, Statuses: map[string]int{}, Daily: []DailyMetric{}, Products: []ProductMetric{}, Stores: []StoreMetric{}}
	ctx := r.Context()
	tx, e := a.Store.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	where := " FROM privacy_analytics WHERE day >= ($1::timestamptz AT TIME ZONE 'Europe/Moscow')::date AND day < ($2::timestamptz AT TIME ZONE 'Europe/Moscow')::date AND ($3::bigint=0 OR store_id=$3) "
	rows, e := tx.QueryContext(ctx, "SELECT status,sum(orders),sum(value)"+where+"GROUP BY status", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	for rows.Next() {
		var status string
		var count int
		var value int64
		if e = rows.Scan(&status, &count, &value); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		report.Orders += count
		report.Statuses[status] = count
		if status == "completed" {
			report.CompletedValue = value
			if count > 0 {
				report.AverageBasket = float64(value) / float64(count)
			}
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	e = tx.QueryRowContext(ctx, `SELECT COALESCE(sum(prep_sum)/NULLIF(sum(prep_samples),0),0),COALESCE(sum(prep_samples),0),COALESCE(sum(ready_sum)/NULLIF(sum(ready_samples),0),0),COALESCE(sum(ready_samples),0),COALESCE(sum(late),0),COALESCE(sum(deadline_samples),0)`+where, start, end, id).Scan(&report.PrepMinutes, &report.PrepSamples, &report.ReadyMinutes, &report.ReadySamples, &report.Late, &report.DeadlineSamples)
	if e != nil {
		fail(w, e)
		return
	}
	rows, e = tx.QueryContext(ctx, "SELECT to_char(day,'YYYY-MM-DD'),sum(orders),sum(value)"+where+"GROUP BY 1 ORDER BY 1", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	for rows.Next() {
		var d DailyMetric
		if e = rows.Scan(&d.Date, &d.Orders, &d.Value); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		report.Daily = append(report.Daily, d)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	productWhere := strings.Replace(where, "privacy_analytics", "privacy_product_analytics", 1)
	rows, e = tx.QueryContext(ctx, "SELECT name,sum(quantity),sum(value)"+productWhere+"GROUP BY name ORDER BY 2 DESC,1 LIMIT 20", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	for rows.Next() {
		var p ProductMetric
		if e = rows.Scan(&p.Name, &p.Quantity, &p.Value); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		report.Products = append(report.Products, p)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	rows, e = tx.QueryContext(ctx, "SELECT store_id,sum(orders),sum(value),COALESCE(sum(prep_sum)/NULLIF(sum(prep_samples),0),0),sum(prep_samples)"+where+"GROUP BY store_id ORDER BY store_id", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var m StoreMetric
		if e = rows.Scan(&m.StoreID, &m.Orders, &m.Value, &m.PrepMinutes, &m.Samples); e != nil {
			fail(w, e)
			return
		}
		report.Stores = append(report.Stores, m)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	rows.Close()
	if e = tx.Commit(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, report)
}
func (a *API) orderHistory(w http.ResponseWriter, r *http.Request) {
	id, ok := a.reportStore(w, r)
	if !ok {
		return
	}
	before := int64(0)
	if value := r.URL.Query().Get("before"); value != "" {
		var e error
		before, e = strconv.ParseInt(value, 10, 64)
		if e != nil || before < 1 {
			fail(w, problem(400, "Некорректная страница."))
			return
		}
	}
	status := r.URL.Query().Get("status")
	if status != "" && status != "new" && status != "preparing" && status != "ready" && status != "completed" && status != "cancelled" {
		fail(w, problem(400, "Некорректный статус."))
		return
	}
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT "+orderCols+" FROM orders WHERE ($1::bigint=0 OR store_id=$1) AND ($2::bigint=0 OR id<$2) AND ($3='' OR status=$3) ORDER BY id DESC LIMIT 100", id, before, status)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		o, e := scanOrder(rows)
		if e != nil {
			fail(w, e)
			return
		}
		out = append(out, o)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, out)
}
