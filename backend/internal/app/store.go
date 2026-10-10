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
	"strings"
	"time"
)

//go:embed schema.sql migrations/*.sql
var migrations embed.FS

type Store struct{ DB *sql.DB }

func Open(ctx context.Context, dsn string) (*Store, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, errors.New("DATABASE_URL is not set; export the target database connection URL before starting the API or running migrations (Go does not load .env automatically)")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db}, nil
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

const productCols = "id,name,description,price,image,weight,category,available,sort_order,ingredients,allergens,options"

func scanProduct(row interface{ Scan(...any) error }) (Product, error) {
	var p Product
	var raw []byte
	e := row.Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.Image, &p.Weight, &p.Category, &p.Available, &p.SortOrder, &p.Ingredients, &p.Allergens, &raw)
	if e == nil {
		e = json.Unmarshal(raw, &p.Options)
	}
	return p, e
}
func (s *Store) Products(ctx context.Context) ([]Product, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT "+productCols+" FROM products ORDER BY sort_order,id")
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
	return scanSettings(s.DB.QueryRowContext(ctx, "SELECT "+settingsCols+" FROM settings WHERE id=1"))
}

const settingsCols = "paused,prep_minutes,pause_message,shop_name,address,city,phone,hours_note,map_url,opening_hours,schedule_enabled,demo_mode"

func scanSettings(row interface{ Scan(...any) error }) (Settings, error) {
	var st Settings
	var raw []byte
	e := row.Scan(&st.Paused, &st.PrepMinutes, &st.PauseMessage, &st.ShopName, &st.Address, &st.City, &st.Phone, &st.HoursNote, &st.MapURL, &raw, &st.ScheduleEnabled, &st.DemoMode)
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
	_, e = tx.ExecContext(ctx, "UPDATE settings SET paused=$1,prep_minutes=$2,pause_message=$3,shop_name=$4,address=$5,city=$6,phone=$7,hours_note=$8,map_url=$9,opening_hours=$10,schedule_enabled=$11,demo_mode=$12 WHERE id=1", st.Paused, st.PrepMinutes, st.PauseMessage, st.ShopName, st.Address, st.City, st.Phone, st.HoursNote, st.MapURL, raw, st.ScheduleEnabled, st.DemoMode)
	if e != nil {
		return e
	}
	if e = audit(ctx, tx, "settings.update", "shop"); e != nil {
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
	if _, e = tx.ExecContext(ctx, "SELECT id FROM settings WHERE id=1 FOR UPDATE"); e != nil {
		return p, e
	}
	if p.ID == 0 {
		e = tx.QueryRowContext(ctx, "INSERT INTO products(name,description,price,image,weight,category,available,sort_order,ingredients,allergens,options) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id", p.Name, p.Description, p.Price, p.Image, p.Weight, p.Category, p.Available, p.SortOrder, p.Ingredients, p.Allergens, raw).Scan(&p.ID)
	} else {
		var result sql.Result
		result, e = tx.ExecContext(ctx, "UPDATE products SET name=$1,description=$2,price=$3,image=$4,weight=$5,category=$6,available=$7,sort_order=$8,ingredients=$10,allergens=$11,options=$12 WHERE id=$9", p.Name, p.Description, p.Price, p.Image, p.Weight, p.Category, p.Available, p.SortOrder, p.ID, p.Ingredients, p.Allergens, raw)
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
	if e = audit(ctx, tx, "product.save", fmt.Sprint(p.ID)); e != nil {
		return p, e
	}
	return p, tx.Commit()
}

const orderCols = "id,number,customer_name,note,status,total,items,estimated_ready_at,created_at,updated_at,cancellation_reason"

func scanOrder(row interface{ Scan(...any) error }) (Order, error) {
	var o Order
	var items []byte
	e := row.Scan(&o.ID, &o.Number, &o.Name, &o.Note, &o.Status, &o.Total, &items, &o.EstimatedReadyAt, &o.CreatedAt, &o.UpdatedAt, &o.CancellationReason)
	if e == nil {
		e = json.Unmarshal(items, &o.Items)
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
	st, e := scanSettings(tx.QueryRowContext(ctx, "SELECT "+settingsCols+" FROM settings WHERE id=1 FOR UPDATE"))
	if e != nil {
		return Order{}, e
	}
	payload, _ := json.Marshal(c)
	requestHash := Hash(string(payload))
	var existingHash string
	e = tx.QueryRowContext(ctx, "SELECT request_hash FROM orders WHERE request_key=$1", c.RequestKey).Scan(&existingHash)
	if e == nil {
		if existingHash != requestHash {
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
	if open, message := st.Intake(time.Now()); !open {
		return Order{}, problem(409, message)
	}
	items := []OrderItem{}
	total := 0
	for _, line := range c.Items {
		p, e := scanProduct(tx.QueryRowContext(ctx, "SELECT "+productCols+" FROM products WHERE id=$1", line.ProductID))
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
				if option.ID == selected {
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
		items = append(items, OrderItem{ProductID: p.ID, Name: p.Name, Price: unitPrice, Quantity: line.Quantity, Options: options})
	}
	var queued int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM orders WHERE status IN ('new','preparing')").Scan(&queued); e != nil {
		return Order{}, e
	}
	minutes := st.PrepMinutes + queued*3
	if minutes > 120 {
		minutes = 120
	}
	eta := time.Now().UTC().Add(time.Duration(minutes) * time.Minute)
	raw, _ := json.Marshal(items)
	o, e := scanOrder(tx.QueryRowContext(ctx, "INSERT INTO orders(token_hash,request_key,request_hash,customer_name,note,total,items,estimated_ready_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "+orderCols, Hash(token), c.RequestKey, requestHash, c.Name, c.Note, total, raw, eta))
	if e != nil {
		return o, e
	}
	o.Token = token
	return o, tx.Commit()
}
func (s *Store) Track(ctx context.Context, token string) (Order, error) {
	o, e := scanOrder(s.DB.QueryRowContext(ctx, "SELECT "+orderCols+" FROM orders WHERE token_hash=$1", Hash(token)))
	o.ID = 0
	o.Name = ""
	o.Note = ""
	return o, e
}
func (s *Store) Orders(ctx context.Context) ([]Order, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT "+orderCols+" FROM orders WHERE status IN ('new','preparing','ready') OR id IN (SELECT id FROM orders WHERE status IN ('completed','cancelled') AND updated_at>now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 300) ORDER BY created_at DESC")
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
	o, e := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderCols+" FROM orders WHERE id=$1 FOR UPDATE", id))
	if e != nil {
		return o, e
	}
	if u.Status != "" {
		if !ValidTransition(o.Status, u.Status) {
			return o, problem(409, "Статус заказа уже изменился. Обновите очередь.")
		}
		o.Status = u.Status
		if u.Status == "cancelled" {
			o.CancellationReason = strings.TrimSpace(u.CancellationReason)
		}
	}
	if u.ETAMinutes != nil {
		if o.Status == "completed" || o.Status == "cancelled" {
			return o, problem(409, "Заказ закрыт.")
		}
		o.EstimatedReadyAt = time.Now().UTC().Add(time.Duration(*u.ETAMinutes) * time.Minute)
	}
	o, e = scanOrder(tx.QueryRowContext(ctx, "UPDATE orders SET status=$1,estimated_ready_at=$2,updated_at=now(),cancellation_reason=$4 WHERE id=$3 RETURNING "+orderCols, o.Status, o.EstimatedReadyAt, id, o.CancellationReason))
	if e != nil {
		return o, e
	}
	if e = audit(ctx, tx, "order.update", fmt.Sprint(id)); e != nil {
		return o, e
	}
	return o, tx.Commit()
}

type staffContextKey struct{}

func audit(ctx context.Context, tx *sql.Tx, action, resource string) error {
	name, _ := ctx.Value(staffContextKey{}).(string)
	if name == "" {
		name = "system"
	}
	_, e := tx.ExecContext(ctx, "INSERT INTO audit_events(staff_name,action,resource) VALUES($1,$2,$3)", name, action, resource)
	return e
}
func (s *Store) EstimatedMinutes(ctx context.Context, base int) (int, error) {
	var queued int
	e := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM orders WHERE status IN ('new','preparing')").Scan(&queued)
	return min(120, base+queued*3), e
}
func (s *Store) Allow(ctx context.Context, key string, max int) (bool, error) {
	var n int
	e := s.DB.QueryRowContext(ctx, `INSERT INTO rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET
 attempts=CASE WHEN rate_limits.window_start<now()-interval '10 minutes' THEN 1 ELSE rate_limits.attempts+1 END,
 window_start=CASE WHEN rate_limits.window_start<now()-interval '10 minutes' THEN now() ELSE rate_limits.window_start END RETURNING attempts`, key).Scan(&n)
	return n <= max, e
}
func (s *Store) CreateSession(ctx context.Context, token string) error {
	return s.CreateNamedSession(ctx, token, "kitchen", "")
}
func (s *Store) CreateNamedSession(ctx context.Context, token, name, credential string) error {
	_, e := s.DB.ExecContext(ctx, "INSERT INTO sessions(token_hash,expires_at,staff_name,credential_hash) VALUES($1,now()+interval '12 hours',$2,$3)", Hash(token), name, credential)
	return e
}
func (s *Store) SessionIdentity(ctx context.Context, token string) (string, string, bool, error) {
	var name, credential string
	e := s.DB.QueryRowContext(ctx, "SELECT staff_name,credential_hash FROM sessions WHERE token_hash=$1 AND expires_at>now()", Hash(token)).Scan(&name, &credential)
	if errors.Is(e, sql.ErrNoRows) {
		return "", "", false, nil
	}
	return name, credential, e == nil, e
}
func (s *Store) SessionValid(ctx context.Context, token string) (bool, error) {
	var ok bool
	e := s.DB.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now())", Hash(token)).Scan(&ok)
	return ok, e
}
func (s *Store) Logout(ctx context.Context, token string) error {
	_, e := s.DB.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=$1", Hash(token))
	return e
}
