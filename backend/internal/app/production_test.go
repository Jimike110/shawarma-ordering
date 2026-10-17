package app

import (
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"io/fs"
	"shawarma/internal/database"
	"strings"
	"testing"
	"time"
)

func TestOpeningHours(t *testing.T) {
	// 2026-10-09 is Friday; UTC timestamps are evaluated in Moscow time.
	s := Settings{ScheduleEnabled: true, OpeningHours: []OpeningHours{{Day: 5, Open: "22:00", Close: "02:00"}}}
	for _, tc := range []struct {
		at   string
		open bool
	}{
		{"2026-10-09T18:59:00Z", false}, {"2026-10-09T19:00:00Z", true},
		{"2026-10-09T22:59:00Z", true}, {"2026-10-09T23:00:00Z", false},
		{"2026-10-10T19:00:00Z", false},
	} {
		at, _ := time.Parse(time.RFC3339, tc.at)
		if open, _ := s.Intake(at); open != tc.open {
			t.Errorf("%s: open=%v", tc.at, open)
		}
	}
	s.Paused = true
	if open, _ := s.Intake(time.Date(2026, 10, 9, 19, 0, 0, 0, time.UTC)); open {
		t.Fatal("pause must override schedule")
	}
	s = Settings{ScheduleEnabled: true}
	if open, _ := s.Intake(time.Now()); open {
		t.Fatal("empty enabled schedule must close intake")
	}
	if e := (Settings{PrepMinutes: 15, OpeningHours: []OpeningHours{{Day: 1, Open: "24:00", Close: "10:00"}}}).Validate(); e == nil {
		t.Fatal("invalid time accepted")
	}
}
func TestCheckoutVariantsAndSnapshots(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	products, _ := store.Products(ctx)
	product := products[0]
	product.Options = []ProductOption{{ID: "cheese", Label: "Дополнительный сыр", Price: 50}, {ID: "sauce", Label: "Без соуса", Price: 0}}
	if _, e := store.SaveProduct(ctx, product); e != nil {
		t.Fatal(e)
	}
	c := checkout()
	c.Items = []CartItem{{ProductID: 1, Quantity: 1, ExpectedPrice: 290}, {ProductID: 1, Quantity: 2, ExpectedPrice: 340, Options: []string{"cheese"}}}
	if e := c.Validate(); e != nil {
		t.Fatal(e)
	}
	o, e := store.CreateOrder(ctx, c, strings.Repeat("t", 43))
	if e != nil {
		t.Fatal(e)
	}
	if o.Total != 970 || len(o.Items) != 2 || o.Items[1].Options[0].Label != "Дополнительный сыр" {
		t.Fatalf("bad customized receipt: %+v", o)
	}
	product.Options[0].Price = 90
	product.Options[0].Label = "Новое название"
	store.SaveProduct(ctx, product)
	tracked, e := store.Track(ctx, strings.Repeat("t", 43))
	if e != nil || tracked.Items[1].Price != 340 || tracked.Items[1].Options[0].Label != "Дополнительный сыр" {
		t.Fatal("historic options changed")
	}
	c.RequestKey = strings.Repeat("b", 36)
	_, e = store.CreateOrder(ctx, c, strings.Repeat("b", 43))
	var p *Problem
	if !errors.As(e, &p) || p.Status != 409 {
		t.Fatal("stale option price accepted")
	}
	c.Items = []CartItem{{ProductID: 1, Quantity: 1, ExpectedPrice: 290, Options: []string{"missing"}}}
	_, e = store.CreateOrder(ctx, c, strings.Repeat("c", 43))
	if !errors.As(e, &p) || p.Status != 409 {
		t.Fatal("unknown option accepted")
	}
	c.Items = []CartItem{{ProductID: 1, Quantity: 1, ExpectedPrice: 290, Options: []string{"cheese", "sauce"}}, {ProductID: 1, Quantity: 1, ExpectedPrice: 290, Options: []string{"sauce", "cheese"}}}
	if c.Validate() == nil {
		t.Fatal("duplicate variants accepted")
	}
}
func TestQueueDoesNotHideOldActiveOrders(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	c := checkout()
	o, e := store.CreateOrder(ctx, c, strings.Repeat("a", 43))
	if e != nil {
		t.Fatal(e)
	}
	_, e = store.DB.ExecContext(ctx, "UPDATE orders SET created_at=now()-interval '2 days' WHERE id=$1", o.ID)
	if e != nil {
		t.Fatal(e)
	}
	_, e = store.DB.ExecContext(ctx, "INSERT INTO orders(token_hash,request_key,request_hash,customer_name,total,items,estimated_ready_at,status) SELECT 'token-'||i,'key-'||i,'hash','closed',290,'[]',now(),'completed' FROM generate_series(1,305) AS i")
	if e != nil {
		t.Fatal(e)
	}
	queue, e := store.Orders(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if len(queue) != 301 {
		t.Fatalf("wanted all active + 300 recent, got %d", len(queue))
	}
	found := false
	for _, q := range queue {
		if q.ID == o.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("old active order hidden")
	}
}
func TestClosedScheduleStillAllowsIdenticalRetry(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	c := checkout()
	token := strings.Repeat("z", 43)
	original, e := store.CreateOrder(ctx, c, token)
	if e != nil {
		t.Fatal(e)
	}
	settings, _ := store.Settings(ctx)
	settings.ScheduleEnabled = true
	settings.OpeningHours = nil
	if e = store.SaveSettings(ctx, settings); e != nil {
		t.Fatal(e)
	}
	retry, e := store.CreateOrder(ctx, c, token)
	if e != nil || retry.ID != original.ID {
		t.Fatal("lost-response retry blocked when shop closed")
	}
	c.RequestKey = strings.Repeat("q", 36)
	_, e = store.CreateOrder(ctx, c, strings.Repeat("q", 43))
	var p *Problem
	if !errors.As(e, &p) || p.Status != 409 {
		t.Fatal("new order accepted while closed")
	}
}
func TestNamedStaffAuditAndRevocation(t *testing.T) {
	store := testStore(t)
	hash, _ := bcrypt.GenerateFromPassword([]byte("test-staff-password"), bcrypt.MinCost)
	config := Config{Origin: "http://localhost:5173", Secret: strings.Repeat("s", 64)}
	if _, e := store.SaveAccount(context.Background(), 0, UserInput{Username: "anna", DisplayName: "Anna", Owner: true, Active: true}, string(hash), false); e != nil {
		t.Fatal(e)
	}
	a := New(store, config)
	rr := call(t, a, "POST", "/api/kitchen/login", map[string]string{"username": "anna", "password": "test-staff-password"}, nil, config.Origin)
	mustStatus(t, rr, 200)
	cookie := sessionCookie(t, rr)
	settings, _ := store.Settings(context.Background())
	settings.Paused = true
	mustStatus(t, call(t, a, "PUT", "/api/kitchen/settings", settings, cookie, config.Origin), 200)
	var name string
	if e := store.DB.QueryRow("SELECT staff_name FROM audit_events WHERE action='settings.update' ORDER BY id DESC LIMIT 1").Scan(&name); e != nil || name != "anna" {
		t.Fatal("staff attribution missing")
	}
	store.DB.Exec("UPDATE staff_accounts SET active=false,version=version+1 WHERE username='anna'")
	a = New(store, config)
	mustStatus(t, call(t, a, "GET", "/api/kitchen/orders", nil, cookie, ""), 401)
}
func TestCancellationAndMaintenance(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	token := strings.Repeat("m", 43)
	o, e := store.CreateOrder(ctx, checkout(), token)
	if e != nil {
		t.Fatal(e)
	}
	o, e = store.UpdateOrder(ctx, o.ID, OrderUpdate{Status: "cancelled", CancellationReason: "Закончилась курица"})
	if e != nil {
		t.Fatal(e)
	}
	tracked, _ := store.Track(ctx, token)
	raw, _ := json.Marshal(tracked)
	if tracked.CancellationReason != "Закончилась курица" || strings.Contains(string(raw), "Михаил") {
		t.Fatal("cancellation reason missing or customer data leaked")
	}
	store.DB.ExecContext(ctx, "UPDATE orders SET updated_at=now()-interval '60 days' WHERE id=$1", o.ID)
	if e = store.Maintenance(ctx, 0); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Track(ctx, token); e != nil {
		t.Fatal("disabled retention removed order")
	}
	if e = store.Maintenance(ctx, 30); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Track(ctx, token); e != nil {
		t.Fatal("retired retention path deleted a receipt")
	}
}
func TestMigrationsPreserveEditsAndAreVersioned(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	products, _ := store.Products(ctx)
	p := products[0]
	p.Name = "Моя шаверма"
	store.SaveProduct(ctx, p)
	if e := store.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	products, _ = store.Products(ctx)
	if products[0].Name != p.Name {
		t.Fatal("migration replaced shop data")
	}
	var count int
	store.DB.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&count)
	files, err := fs.ReadDir(database.Sources(), "migrations")
	if err != nil {
		t.Fatal(err)
	}
	if count != 1+len(files) {
		t.Fatalf("wrong migration count %d", count)
	}
}
