package app

import (
	"database/sql"

	"encoding/json"
	"net/http"

	"fmt"
	"regexp"
)

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
