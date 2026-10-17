package app

import (
	"encoding/json"

	"database/sql"

	"context"
	"errors"
	"fmt"
)

const productCols = "id,name,description,price,image,weight,category,available,sort_order,ingredients,allergens,options,COALESCE(topping_id,0)"

func scanProduct(row interface{ Scan(...any) error }) (Product, error) {
	var p Product
	var raw []byte
	e := row.Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.Image, &p.Weight, &p.Category, &p.Available, &p.SortOrder, &p.Ingredients, &p.Allergens, &raw, &p.ToppingID)
	if e == nil {
		e = json.Unmarshal(raw, &p.Options)
	}
	return p, e
}

func (s *Store) Products(ctx context.Context) ([]Product, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT "+productCols+" FROM products WHERE store_id=$1 ORDER BY sort_order,id", shopID(ctx))
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	products := []Product{}
	for rows.Next() {
		p, e := scanProduct(rows)
		if e != nil {
			return nil, e
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func (s *Store) SaveProduct(ctx context.Context, p Product) (Product, error) {
	raw, _ := json.Marshal(p.Options)
	if p.Options == nil {
		raw = []byte("[]")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return p, e
	}
	defer tx.Rollback()
	// Product edits and checkout share this lock so price and availability changes are atomic.
	if _, e = tx.ExecContext(ctx, "SELECT id FROM stores WHERE id=$1 FOR UPDATE", shopID(ctx)); e != nil {
		return p, e
	}
	// Canonical extras are owned by the topping catalogue, never by a full-product payload.
	legacy := []ProductOption{}
	for _, o := range p.Options {
		if o.ToppingID == 0 {
			legacy = append(legacy, o)
		}
	}
	if p.ID != 0 {
		current, err := scanProduct(tx.QueryRowContext(ctx, "SELECT "+productCols+" FROM products WHERE id=$1 AND store_id=$2", p.ID, shopID(ctx)))
		if err == sql.ErrNoRows {
			return p, ErrMissing
		}
		if err != nil {
			return p, err
		}
		if current.ToppingID != 0 {
			return p, problem(400, "Измените позицию в разделе «Добавки и соусы».")
		}
		for _, o := range current.Options {
			if o.ToppingID != 0 {
				legacy = append(legacy, o)
			}
		}
	}
	p.ToppingID = 0
	p.Options = legacy
	if e = p.Validate(); e != nil {
		return p, e
	}
	raw, _ = json.Marshal(p.Options)
	if p.ID == 0 {
		e = tx.QueryRowContext(ctx, "INSERT INTO products(name,description,price,image,weight,category,available,sort_order,ingredients,allergens,options,store_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id", p.Name, p.Description, p.Price, p.Image, p.Weight, p.Category, p.Available, p.SortOrder, p.Ingredients, p.Allergens, raw, shopID(ctx)).Scan(&p.ID)
	} else {
		var result sql.Result
		result, e = tx.ExecContext(ctx, "UPDATE products SET name=$1,description=$2,price=$3,image=$4,weight=$5,category=$6,available=$7,sort_order=$8,ingredients=$10,allergens=$11,options=$12 WHERE id=$9 AND store_id=$13", p.Name, p.Description, p.Price, p.Image, p.Weight, p.Category, p.Available, p.SortOrder, p.ID, p.Ingredients, p.Allergens, raw, shopID(ctx))
		if e == nil {
			n, _ := result.RowsAffected()
			if n == 0 {
				return p, ErrMissing
			}
		}
	}
	if e != nil {
		return p, e
	}
	if e = auditDetails(ctx, tx, "product.save", fmt.Sprint(p.ID), mustJSON(p)); e != nil {
		return p, e
	}
	return p, tx.Commit()
}

func (s *Store) DeleteProduct(ctx context.Context, id int64) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	// Serialize deletion with checkout, menu copying and other menu edits.
	if _, e = tx.ExecContext(ctx, "SELECT id FROM stores WHERE id=$1 FOR UPDATE", shopID(ctx)); e != nil {
		return e
	}
	var name string
	var topping int64
	e = tx.QueryRowContext(ctx, "SELECT COALESCE(topping_id,0) FROM products WHERE id=$1 AND store_id=$2", id, shopID(ctx)).Scan(&topping)
	if e == sql.ErrNoRows {
		return ErrMissing
	}
	if e != nil {
		return e
	}
	if topping != 0 {
		if e = removeTopping(ctx, tx, topping, shopID(ctx)); e != nil {
			return e
		}
	}
	e = tx.QueryRowContext(ctx, "DELETE FROM products WHERE id=$1 AND store_id=$2 RETURNING name", id, shopID(ctx)).Scan(&name)
	if errors.Is(e, sql.ErrNoRows) {
		return ErrMissing
	}
	if e != nil {
		return e
	}
	// Orders retain their own purchased-item snapshots; never alter those here.
	if e = auditDetails(ctx, tx, "product.delete", fmt.Sprint(id), mustJSON(map[string]string{"name": name})); e != nil {
		return e
	}
	return tx.Commit()
}
