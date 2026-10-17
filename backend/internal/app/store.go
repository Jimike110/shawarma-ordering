package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"os"
	"strings"
	"time"
)

//go:embed schema.sql migrations/*.sql
var migrations embed.FS

type Store struct {
	DB          *sql.DB
	PrivacyKey  string
	JournalPath string
	Telegram    TelegramConfig
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, errors.New("DATABASE_URL is not set; export the target database connection URL before starting the API or running migrations (Go does not load .env automatically)")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("database configuration failed (%T)", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("database connection failed (%T)", err)
	}
	return &Store{DB: db, PrivacyKey: os.Getenv("SESSION_SECRET"), JournalPath: os.Getenv("PRIVACY_JOURNAL_PATH")}, nil
}
func (s *Store) Migrate(ctx context.Context) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184014)"); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); e != nil {
		return e
	}
	files := []string{"schema.sql"}
	entries, e := migrations.ReadDir("migrations")
	if e != nil {
		return e
	}
	for _, entry := range entries {
		files = append(files, "migrations/"+entry.Name())
	}
	for _, file := range files {
		var applied bool
		if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", file).Scan(&applied); e != nil {
			return e
		}
		if applied {
			continue
		}
		body, err := migrations.ReadFile(file)
		if err != nil {
			return err
		}
		if _, e = tx.ExecContext(ctx, string(body)); e != nil {
			return fmt.Errorf("migration %s: %w", file, e)
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", file); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func Hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

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
func (s *Store) Settings(ctx context.Context) (Settings, error) {
	return scanSettings(s.DB.QueryRowContext(ctx, "SELECT "+settingsCols+" FROM settings WHERE id=$1", shopID(ctx)))
}

const settingsCols = "paused,prep_minutes,pause_message,shop_name,address,city,phone,hours_note,map_url,opening_hours,schedule_enabled,demo_mode,latitude,longitude,landmark,entrance"

func scanSettings(row interface{ Scan(...any) error }) (Settings, error) {
	var st Settings
	var raw []byte
	e := row.Scan(&st.Paused, &st.PrepMinutes, &st.PauseMessage, &st.ShopName, &st.Address, &st.City, &st.Phone, &st.HoursNote, &st.MapURL, &raw, &st.ScheduleEnabled, &st.DemoMode, &st.Latitude, &st.Longitude, &st.Landmark, &st.Entrance)
	if e == nil {
		e = json.Unmarshal(raw, &st.OpeningHours)
	}
	return st, e
}
func (s *Store) SaveSettings(ctx context.Context, st Settings) error {
	raw, _ := json.Marshal(st.OpeningHours)
	if st.OpeningHours == nil {
		raw = []byte("[]")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT id FROM stores WHERE id=$1 FOR UPDATE", shopID(ctx)); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "UPDATE settings SET paused=$1,prep_minutes=$2,pause_message=$3,shop_name=$4,address=$5,city=$6,phone=$7,hours_note=$8,map_url=$9,opening_hours=$10,schedule_enabled=$11,demo_mode=$12,latitude=$14,longitude=$15,landmark=$16,entrance=$17 WHERE id=$13", st.Paused, st.PrepMinutes, st.PauseMessage, st.ShopName, st.Address, st.City, st.Phone, st.HoursNote, st.MapURL, raw, st.ScheduleEnabled, st.DemoMode, shopID(ctx), st.Latitude, st.Longitude, strings.TrimSpace(st.Landmark), strings.TrimSpace(st.Entrance))
	if e != nil {
		return e
	}
	if e = auditDetails(ctx, tx, "settings.update", "shop", mustJSON(st)); e != nil {
		return e
	}
	return tx.Commit()
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

type staffContextKey struct{}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func audit(ctx context.Context, tx *sql.Tx, action, resource string) error {
	return auditDetails(ctx, tx, action, resource, []byte("{}"))
}
func (s *Store) EstimatedMinutes(ctx context.Context, base int) (int, error) {
	var queued int
	e := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing')", shopID(ctx)).Scan(&queued)
	return min(120, base+queued*3), e
}
func (s *Store) Allow(ctx context.Context, key string, max int) (bool, error) {
	var n int
	e := s.DB.QueryRowContext(ctx, `INSERT INTO rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET
 attempts=CASE WHEN rate_limits.window_start<now()-interval '10 minutes' THEN 1 ELSE rate_limits.attempts+1 END,
 window_start=CASE WHEN rate_limits.window_start<now()-interval '10 minutes' THEN now() ELSE rate_limits.window_start END RETURNING attempts`, key).Scan(&n)
	return n <= max, e
}
