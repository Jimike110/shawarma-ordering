package app

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

type Topping struct {
	ID                  int64   `json:"id"`
	Name                string  `json:"name"`
	Description         string  `json:"description"`
	Image               string  `json:"image"`
	Ingredients         string  `json:"ingredients"`
	Allergens           string  `json:"allergens"`
	Available           bool    `json:"available"`
	ExtraPrice          int     `json:"extra_price"`
	ExtraPortion        string  `json:"extra_portion"`
	StandalonePrice     int     `json:"standalone_price"`
	StandalonePortion   string  `json:"standalone_portion"`
	StandaloneProductID int64   `json:"standalone_product_id"`
	ProductIDs          []int64 `json:"product_ids"`
}

const toppingCols = "id,name,description,image,ingredients,allergens,available,extra_price,extra_portion,standalone_price,standalone_portion,standalone_product_id"

func scanTopping(row interface{ Scan(...any) error }) (Topping, error) {
	var t Topping
	e := row.Scan(&t.ID, &t.Name, &t.Description, &t.Image, &t.Ingredients, &t.Allergens, &t.Available, &t.ExtraPrice, &t.ExtraPortion, &t.StandalonePrice, &t.StandalonePortion, &t.StandaloneProductID)
	return t, e
}
func (t Topping) product() Product {
	return Product{Name: t.Name, Description: t.Description, Price: t.StandalonePrice, Image: t.Image, Weight: t.StandalonePortion, Category: "Добавки и соусы", Available: t.Available, Ingredients: t.Ingredients, Allergens: t.Allergens}
}
func (t *Topping) validate() error {
	t.Name = strings.TrimSpace(t.Name)
	p := t.product()
	if e := p.Validate(); e != nil {
		return e
	}
	if utf8.RuneCountInString(t.Name) > 80 || len(t.ExtraPortion) > 40 || len(t.StandalonePortion) > 40 || t.ExtraPrice < 0 || t.ExtraPrice > 10000 || len(t.ProductIDs) > 500 {
		return problem(400, "Проверьте название, порции, цену и назначения добавки.")
	}
	seen := map[int64]bool{}
	for _, id := range t.ProductIDs {
		if id < 1 || seen[id] {
			return problem(400, "Проверьте блюда для добавки.")
		}
		seen[id] = true
	}
	return nil
}
func (a *API) listToppings(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT "+toppingCols+" FROM toppings WHERE store_id=$1 ORDER BY id", shopID(r.Context()))
	if e != nil {
		fail(w, e)
		return
	}
	out := []Topping{}
	for rows.Next() {
		t, err := scanTopping(rows)
		if err != nil {
			rows.Close()
			fail(w, err)
			return
		}
		t.ProductIDs = []int64{}
		out = append(out, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	links, e := a.Store.DB.QueryContext(r.Context(), "SELECT topping_id,product_id FROM product_toppings WHERE store_id=$1 ORDER BY product_id", shopID(r.Context()))
	if e != nil {
		fail(w, e)
		return
	}
	defer links.Close()
	indexes := map[int64]int{}
	for i, t := range out {
		indexes[t.ID] = i
	}
	for links.Next() {
		var tid, pid int64
		if e = links.Scan(&tid, &pid); e != nil {
			fail(w, e)
			return
		}
		if i, ok := indexes[tid]; ok {
			out[i].ProductIDs = append(out[i].ProductIDs, pid)
		}
	}
	if e = links.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, out)
}

// Must hold the store lock shared with checkout. Materialized options keep legacy wire IDs intact.
func syncTopping(ctx context.Context, tx *sql.Tx, t Topping, sid int64) error {
	assigned := map[int64]string{}
	rows, e := tx.QueryContext(ctx, "SELECT product_id,option_id FROM product_toppings WHERE topping_id=$1 AND store_id=$2", t.ID, sid)
	if e != nil {
		return e
	}
	for rows.Next() {
		var id int64
		var option string
		if e = rows.Scan(&id, &option); e != nil {
			rows.Close()
			return e
		}
		assigned[id] = option
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	products, e := tx.QueryContext(ctx, "SELECT "+productCols+" FROM products WHERE store_id=$1 ORDER BY id", sid)
	if e != nil {
		return e
	}
	all := []Product{}
	for products.Next() {
		p, err := scanProduct(products)
		if err != nil {
			products.Close()
			return err
		}
		all = append(all, p)
	}
	e = products.Err()
	products.Close()
	if e != nil {
		return e
	}
	for _, p := range all {
		next := []ProductOption{}
		changed := false
		for _, o := range p.Options {
			if o.ToppingID == t.ID {
				changed = true
			} else {
				next = append(next, o)
			}
		}
		if oid, ok := assigned[p.ID]; ok {
			if p.ToppingID != 0 {
				return problem(400, "Добавка не может быть блюдом для другой добавки.")
			}
			next = append(next, ProductOption{ID: oid, Label: t.Name, Price: t.ExtraPrice, Portion: t.ExtraPortion, Available: &t.Available, ToppingID: t.ID})
			changed = true
		}
		if !changed {
			continue
		}
		p.Options = next
		if e = p.Validate(); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE products SET options=$1 WHERE id=$2 AND store_id=$3", mustJSON(next), p.ID, sid); e != nil {
			return e
		}
	}
	return nil
}
func saveToppingTx(ctx context.Context, tx *sql.Tx, t Topping, sid int64) (Topping, error) {
	if e := t.validate(); e != nil {
		return t, e
	}
	var e error
	if t.ID == 0 {
		p := t.product()
		e = tx.QueryRowContext(ctx, "INSERT INTO products(store_id,name,description,price,image,weight,category,available,ingredients,allergens,options) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]') RETURNING id", sid, p.Name, p.Description, p.Price, p.Image, p.Weight, p.Category, p.Available, p.Ingredients, p.Allergens).Scan(&t.StandaloneProductID)
		if e != nil {
			return t, e
		}
		e = tx.QueryRowContext(ctx, "INSERT INTO toppings(store_id,name,description,image,ingredients,allergens,available,extra_price,extra_portion,standalone_price,standalone_portion,standalone_product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id", sid, t.Name, t.Description, t.Image, t.Ingredients, t.Allergens, t.Available, t.ExtraPrice, t.ExtraPortion, t.StandalonePrice, t.StandalonePortion, t.StandaloneProductID).Scan(&t.ID)
	} else {
		e = tx.QueryRowContext(ctx, "UPDATE toppings SET name=$3,description=$4,image=$5,ingredients=$6,allergens=$7,available=$8,extra_price=$9,extra_portion=$10,standalone_price=$11,standalone_portion=$12 WHERE id=$1 AND store_id=$2 RETURNING standalone_product_id", t.ID, sid, t.Name, t.Description, t.Image, t.Ingredients, t.Allergens, t.Available, t.ExtraPrice, t.ExtraPortion, t.StandalonePrice, t.StandalonePortion).Scan(&t.StandaloneProductID)
	}
	if e == sql.ErrNoRows {
		return t, ErrMissing
	}
	if e != nil {
		return t, e
	}
	_, e = tx.ExecContext(ctx, "UPDATE products SET topping_id=$1,name=$3,description=$4,image=$5,ingredients=$6,allergens=$7,available=$8,price=$9,weight=$10,category='Добавки и соусы' WHERE id=$2 AND store_id=$11", t.ID, t.StandaloneProductID, t.Name, t.Description, t.Image, t.Ingredients, t.Allergens, t.Available, t.StandalonePrice, t.StandalonePortion, sid)
	if e != nil {
		return t, e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM product_toppings WHERE topping_id=$1 AND store_id=$2", t.ID, sid); e != nil {
		return t, e
	}
	for _, pid := range t.ProductIDs {
		var valid bool
		if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND store_id=$2 AND topping_id IS NULL)", pid, sid).Scan(&valid); e != nil {
			return t, e
		}
		if !valid {
			return t, problem(400, "Блюдо не принадлежит этой точке или само является добавкой.")
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO product_toppings(store_id,product_id,topping_id,option_id) VALUES($1,$2,$3,$4)", sid, pid, t.ID, fmt.Sprint("t", t.ID)); e != nil {
			return t, e
		}
	}
	e = syncTopping(ctx, tx, t, sid)
	return t, e
}
func (a *API) saveTopping(w http.ResponseWriter, r *http.Request) {
	var t Topping
	if !decode(w, r, &t) {
		return
	}
	if r.Method == "PUT" {
		id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if e != nil || id < 1 {
			fail(w, ErrMissing)
			return
		}
		t.ID = id
	} else {
		t.ID = 0
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	sid := shopID(r.Context())
	if _, e = tx.ExecContext(r.Context(), "SELECT id FROM stores WHERE id=$1 FOR UPDATE", sid); e == nil {
		t, e = saveToppingTx(r.Context(), tx, t, sid)
	}
	if e == nil {
		e = auditDetails(r.Context(), tx, "topping.save", fmt.Sprint(t.ID), mustJSON(t))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, t)
}
func removeTopping(ctx context.Context, tx *sql.Tx, id, sid int64) error {
	if _, e := tx.ExecContext(ctx, "DELETE FROM product_toppings WHERE topping_id=$1 AND store_id=$2", id, sid); e != nil {
		return e
	}
	if e := syncTopping(ctx, tx, Topping{ID: id}, sid); e != nil {
		return e
	}
	_, e := tx.ExecContext(ctx, "DELETE FROM toppings WHERE id=$1 AND store_id=$2", id, sid)
	return e
}
func setToppingAvailable(ctx context.Context, tx *sql.Tx, id, sid int64, value bool) error {
	t, e := scanTopping(tx.QueryRowContext(ctx, "UPDATE toppings SET available=$3 WHERE id=$1 AND store_id=$2 RETURNING "+toppingCols, id, sid, value))
	if e == sql.ErrNoRows {
		return ErrMissing
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE products SET available=$1 WHERE id=$2 AND store_id=$3", value, t.StandaloneProductID, sid); e != nil {
		return e
	}
	return syncTopping(ctx, tx, t, sid)
}
func (a *API) toppingAvailability(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || id < 1 {
		fail(w, ErrMissing)
		return
	}
	var in struct {
		Available *bool `json:"available"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Available == nil {
		fail(w, problem(400, "Укажите доступность."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	sid := shopID(r.Context())
	if _, e = tx.ExecContext(r.Context(), "SELECT id FROM stores WHERE id=$1 FOR UPDATE", sid); e == nil {
		e = setToppingAvailable(r.Context(), tx, id, sid, *in.Available)
	}
	if e == nil {
		e = auditDetails(r.Context(), tx, "topping.availability", fmt.Sprint(id), mustJSON(in))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, in)
}

func copyToppings(ctx context.Context, tx *sql.Tx, source, destination int64, original []Product, mapping map[int64]int64, copied []Product) ([]Product, error) {
	needed := map[int64]bool{}
	for _, p := range original {
		if p.ToppingID != 0 {
			needed[p.ToppingID] = true
		}
		for _, o := range p.Options {
			if o.ToppingID != 0 {
				needed[o.ToppingID] = true
			}
		}
	}
	ids := []int64{}
	for id := range needed {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		t, e := scanTopping(tx.QueryRowContext(ctx, "SELECT "+toppingCols+" FROM toppings WHERE id=$1 AND store_id=$2", id, source))
		if e != nil {
			return nil, e
		}
		oldTopping := t.ID
		destinationProduct, ok := mapping[t.StandaloneProductID]
		if !ok {
			e = tx.QueryRowContext(ctx, "INSERT INTO products(store_id,name,description,price,image,weight,category,available,ingredients,allergens,options) VALUES($1,$2,$3,$4,$5,$6,'Добавки и соусы',false,$7,$8,'[]') RETURNING id", destination, t.Name, t.Description, t.StandalonePrice, t.Image, t.StandalonePortion, t.Ingredients, t.Allergens).Scan(&destinationProduct)
			if e != nil {
				return nil, e
			}
			mapping[t.StandaloneProductID] = destinationProduct
			copied = append(copied, Product{ID: destinationProduct})
		}
		t.Available = false
		t.StandaloneProductID = destinationProduct
		e = tx.QueryRowContext(ctx, "INSERT INTO toppings(store_id,name,description,image,ingredients,allergens,available,extra_price,extra_portion,standalone_price,standalone_portion,standalone_product_id) VALUES($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11) RETURNING id", destination, t.Name, t.Description, t.Image, t.Ingredients, t.Allergens, t.ExtraPrice, t.ExtraPortion, t.StandalonePrice, t.StandalonePortion, t.StandaloneProductID).Scan(&t.ID)
		if e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE products SET topping_id=$1 WHERE id=$2 AND store_id=$3", t.ID, destinationProduct, destination); e != nil {
			return nil, e
		}
		rows, e := tx.QueryContext(ctx, "SELECT product_id FROM product_toppings WHERE topping_id=$1 AND store_id=$2", oldTopping, source)
		if e != nil {
			return nil, e
		}
		targets := []int64{}
		for rows.Next() {
			var pid int64
			if e = rows.Scan(&pid); e != nil {
				rows.Close()
				return nil, e
			}
			if next, found := mapping[pid]; found {
				targets = append(targets, next)
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		for _, pid := range targets {
			if _, e = tx.ExecContext(ctx, "INSERT INTO product_toppings(store_id,product_id,topping_id,option_id) VALUES($1,$2,$3,$4)", destination, pid, t.ID, fmt.Sprint("t", t.ID)); e != nil {
				return nil, e
			}
		}
		if e = syncTopping(ctx, tx, t, destination); e != nil {
			return nil, e
		}
	}
	for i, p := range copied {
		next, e := scanProduct(tx.QueryRowContext(ctx, "SELECT "+productCols+" FROM products WHERE id=$1 AND store_id=$2", p.ID, destination))
		if e != nil {
			return nil, e
		}
		copied[i] = next
	}
	return copied, nil
}
