package app

import (
	"encoding/json"

	"context"
	"strings"

	"database/sql"
	"errors"

	"fmt"
	"time"
)

const orderCols = "id,number,CASE WHEN personal_blocked THEN '' ELSE customer_name END,CASE WHEN personal_blocked THEN '' ELSE note END,status,total,items,estimated_ready_at,created_at,updated_at,CASE WHEN personal_blocked THEN '' ELSE cancellation_reason END,store_id,store_slug,shop,cancelled_by"

func scanOrder(row interface{ Scan(...any) error }) (Order, error) {
	var o Order
	var items, shop []byte
	e := row.Scan(&o.ID, &o.Number, &o.Name, &o.Note, &o.Status, &o.Total, &items, &o.EstimatedReadyAt, &o.CreatedAt, &o.UpdatedAt, &o.CancellationReason, &o.StoreID, &o.StoreSlug, &shop, &o.CancelledBy)
	if e == nil {
		e = json.Unmarshal(items, &o.Items)
		if e == nil {
			e = json.Unmarshal(shop, &o.Shop)
		}
	}
	if errors.Is(e, sql.ErrNoRows) {
		e = ErrMissing
	}
	return o, e
}

func (s *Store) CreateOrder(ctx context.Context, c Checkout, token string) (Order, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Order{}, e
	}
	defer tx.Rollback()
	// A receipt and its replay tombstone must not change between the retry checks.
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock_shared(184020)"); e != nil {
		return Order{}, e
	}
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,184017))", "order-request:"+c.RequestKey); e != nil {
		return Order{}, e
	}
	if c.StoreID == 0 {
		c.StoreID = 1
	}

	var expiredStore int64
	e = tx.QueryRowContext(ctx, "SELECT store_id FROM expired_order_keys WHERE digest=$1", s.privacyDigest("retry", c.RequestKey)).Scan(&expiredStore)
	if e == nil {
		if expiredStore != c.StoreID {
			return Order{}, problem(409, "Этот ключ уже использован в другой точке.")
		}
		return Order{}, problem(410, "Срок хранения заказа истёк. Этот ключ не может создать новый заказ.")
	}
	if e != sql.ErrNoRows {
		return Order{}, e
	}
	ctx = shopContext(ctx, c.StoreID)
	var slug string
	var published, archived, stopped bool
	e = tx.QueryRowContext(ctx, "SELECT slug,published,archived,owner_stopped FROM stores WHERE id=$1 FOR UPDATE", c.StoreID).Scan(&slug, &published, &archived, &stopped)
	if e == sql.ErrNoRows {
		return Order{}, problem(409, "Точка недоступна.")
	}
	if e != nil {
		return Order{}, e
	}
	st, e := scanSettings(tx.QueryRowContext(ctx, "SELECT "+settingsCols+" FROM settings WHERE id=$1 FOR UPDATE", c.StoreID))
	if e != nil {
		return Order{}, e
	}
	payload, _ := json.Marshal(c)
	requestHash := Hash(string(payload))
	legacy := c
	legacy.StoreID = 0
	legacyPayload, _ := json.Marshal(legacy)
	legacyHash := Hash(string(legacyPayload))
	var existingHash string
	var existingStore int64
	e = tx.QueryRowContext(ctx, "SELECT request_hash,store_id FROM orders WHERE request_key=$1", c.RequestKey).Scan(&existingHash, &existingStore)
	if e == nil {
		if existingStore != c.StoreID || (existingHash != requestHash && !(c.StoreID == 1 && existingHash == legacyHash)) {
			return Order{}, problem(409, "Этот ключ уже использован для другого заказа.")
		}
		o, e := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderCols+" FROM orders WHERE request_key=$1", c.RequestKey))
		if e != nil {
			return o, e
		}
		o.Token = token
		return o, tx.Commit()
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return Order{}, e
	}
	version, e := checkPrivacy(ctx, tx, c)
	if e != nil {
		return Order{}, e
	}
	if e = s.checkTelegramCheckout(ctx, tx, c); e != nil {
		return Order{}, e
	}
	if !published || archived || stopped {
		return Order{}, problem(409, "Точка сейчас не принимает заказы.")
	}
	if open, message := st.Intake(time.Now()); !open {
		return Order{}, problem(409, message)
	}
	items := []OrderItem{}
	total := 0
	for _, line := range c.Items {
		p, e := scanProduct(tx.QueryRowContext(ctx, "SELECT "+productCols+" FROM products WHERE id=$1 AND store_id=$2", line.ProductID, c.StoreID))
		if errors.Is(e, sql.ErrNoRows) {
			return Order{}, problem(409, "Товар больше не доступен. Обновите меню.")
		}
		if e != nil {
			return Order{}, e
		}
		if !p.Available {
			return Order{}, problem(409, "Товар «"+p.Name+"» временно недоступен.")
		}
		unitPrice := p.Price
		options := []ProductOption{}
		for _, selected := range line.Options {
			found := false
			for _, option := range p.Options {
				if option.ID == selected && (option.Available == nil || *option.Available) {
					unitPrice += option.Price
					options = append(options, option)
					found = true
					break
				}
			}
			if !found {
				return Order{}, problem(409, "Опции товара изменились. Проверьте корзину.")
			}
		}
		if unitPrice != line.ExpectedPrice {
			return Order{}, problem(409, "Цена изменилась. Обновите меню и проверьте корзину.")
		}
		total += unitPrice * line.Quantity
		items = append(items, OrderItem{ProductID: p.ID, Name: p.Name, Price: unitPrice, Quantity: line.Quantity, Options: options, Portion: p.Weight})
	}
	var queued int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing')", shopID(ctx)).Scan(&queued); e != nil {
		return Order{}, e
	}
	minutes := st.PrepMinutes + queued*3
	if minutes > 120 {
		minutes = 120
	}
	eta := time.Now().UTC().Add(time.Duration(minutes) * time.Minute)
	raw, _ := json.Marshal(items)
	o, e := scanOrder(tx.QueryRowContext(ctx, "INSERT INTO orders(token_hash,request_key,request_hash,customer_name,note,total,items,estimated_ready_at,store_id,store_slug,shop,initial_ready_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$8) RETURNING "+orderCols, Hash(token), c.RequestKey, requestHash, c.Name, c.Note, total, raw, eta, c.StoreID, slug, mustJSON(st)))
	if e != nil {
		return o, e
	}
	o.Token = token
	if _, e = tx.ExecContext(ctx, "INSERT INTO order_events(order_id,store_id,status) VALUES($1,$2,'new')", o.ID, c.StoreID); e != nil {
		return Order{}, e
	}
	state := "not_provided"
	if c.Privacy.Accepted {
		state = "accepted"
	}
	if _, e = tx.ExecContext(ctx, "UPDATE orders SET notice_version=$1,consent_state=$2 WHERE id=$3", version, state, o.ID); e != nil {
		return Order{}, e
	}
	if c.Privacy.Accepted {
		if _, e = tx.ExecContext(ctx, "INSERT INTO privacy_evidence(order_ref,purpose,version_id,accepted) VALUES($1,'optional_name_preparation',$2,true)", o.ID, version); e != nil {
			return Order{}, e
		}
	}
	if e = s.attachTelegram(ctx, tx, c, o.ID); e != nil {
		return Order{}, e
	}
	return o, tx.Commit()
}

func (s *Store) Track(ctx context.Context, token string) (Order, error) {
	o, e := scanOrder(s.DB.QueryRowContext(ctx, "SELECT "+orderCols+" FROM orders WHERE token_hash=$1", Hash(token)))
	o.ID = 0
	o.Name = ""
	o.Note = ""
	o.CancelledBy = ""
	if errors.Is(e, ErrMissing) {
		var expired bool
		err := s.DB.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM expired_receipt_tokens WHERE digest=$1)", s.privacyDigest("receipt", Hash(token))).Scan(&expired)
		if err != nil {
			return o, err
		}
		if expired {
			return o, problem(410, "Срок хранения квитанции истёк. Индивидуальные данные заказа удалены.")
		}
	}
	return o, e
}

func (s *Store) Orders(ctx context.Context) ([]Order, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT "+orderCols+" FROM orders WHERE store_id=$1 AND (status IN ('new','preparing','ready') OR id IN (SELECT id FROM orders WHERE store_id=$1 AND status IN ('completed','cancelled') AND updated_at>now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 300)) ORDER BY created_at DESC", shopID(ctx))
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	orders := []Order{}
	for rows.Next() {
		o, e := scanOrder(rows)
		if e != nil {
			return nil, e
		}
		orders = append(orders, o)
	}
	return orders, rows.Err()
}

func (s *Store) UpdateOrder(ctx context.Context, id int64, u OrderUpdate) (Order, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Order{}, e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock_shared(184020)"); e != nil {
		return Order{}, e
	}
	o, e := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderCols+" FROM orders WHERE id=$1 AND store_id=$2 FOR UPDATE", id, shopID(ctx)))
	if e != nil {
		return o, e
	}
	previousStatus := o.Status
	if u.Status != "" {
		if !ValidTransition(o.Status, u.Status) {
			return o, problem(409, "Статус заказа уже изменился. Обновите очередь.")
		}
		o.Status = u.Status
		if u.Status == "cancelled" {
			o.CancellationReason = strings.TrimSpace(u.CancellationReason)
			if previousStatus != o.Status {
				o.CancelledBy = actor(ctx).Username
			}
		}
	}
	if u.ETAMinutes != nil {
		if o.Status == "completed" || o.Status == "cancelled" {
			return o, problem(409, "Заказ закрыт.")
		}
		o.EstimatedReadyAt = time.Now().UTC().Add(time.Duration(*u.ETAMinutes) * time.Minute)
	}
	o, e = scanOrder(tx.QueryRowContext(ctx, "UPDATE orders SET closed_at=CASE WHEN $1 IN ('completed','cancelled') THEN COALESCE(closed_at,now()) ELSE closed_at END,status=$1,estimated_ready_at=$2,updated_at=now(),cancellation_reason=CASE WHEN personal_erased_at IS NULL AND NOT personal_blocked THEN $4 ELSE '' END,cancelled_by=$6 WHERE id=$3 AND store_id=$5 RETURNING "+orderCols, o.Status, o.EstimatedReadyAt, id, o.CancellationReason, shopID(ctx), o.CancelledBy))
	if e != nil {
		return o, e
	}
	if previousStatus != o.Status {
		if e = enqueueTelegram(ctx, tx, id, o.Status); e != nil {
			return o, e
		}
		var aid any
		if actor(ctx).ID > 0 {
			aid = actor(ctx).ID
		}
		var did any
		if actor(ctx).DeviceID > 0 {
			did = actor(ctx).DeviceID
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO order_events(order_id,store_id,actor_id,status,device_id) VALUES($1,$2,$3,$4,$5)", id, shopID(ctx), aid, o.Status, did); e != nil {
			return o, e
		}
	}
	// Free-text cancellation reasons live only on the protected receipt, never in audit copies.
	if e = auditDetails(ctx, tx, "order.update", fmt.Sprint(id), mustJSON(map[string]any{"status": u.Status, "eta_minutes": u.ETAMinutes})); e != nil {
		return o, e
	}
	return o, tx.Commit()
}

func (s *Store) EstimatedMinutes(ctx context.Context, base int) (int, error) {
	var queued int
	e := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing')", shopID(ctx)).Scan(&queued)
	return min(120, base+queued*3), e
}
