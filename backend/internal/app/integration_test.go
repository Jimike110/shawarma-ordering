package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("Set TEST_DATABASE_URL to run real PostgreSQL integration tests")
	}
	admin, e := Open(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	name := fmt.Sprintf("shawarma_test_%d", time.Now().UnixNano())
	if _, e = admin.DB.Exec("CREATE SCHEMA " + name); e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	q := u.Query()
	q.Set("search_path", name)
	u.RawQuery = q.Encode()
	store, e := Open(context.Background(), u.String())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { store.DB.Close(); _, _ = admin.DB.Exec("DROP SCHEMA " + name + " CASCADE"); admin.DB.Close() })
	if e = store.Migrate(context.Background()); e != nil {
		t.Fatal(e)
	}
	store.PrivacyKey = strings.Repeat("test-key-", 8)
	store.JournalPath = t.TempDir() + "/journal.jsonl"
	o := testOperator()
	policy, consent := privacyTexts(o)
	if _, e = store.DB.Exec("INSERT INTO privacy_versions(template_version,operator,policy,consent) VALUES($1,$2,$3,$4)", privacyTemplate, mustJSON(o), policy, consent); e != nil {
		t.Fatal(e)
	}
	if _, e = store.DB.Exec("UPDATE privacy_settings SET draft=$1,current_version=1 WHERE id=1", mustJSON(o)); e != nil {
		t.Fatal(e)
	}

	return store
}
func call(t *testing.T, a http.Handler, method, route string, body any, cookie *http.Cookie, origin string) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, route, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rr := httptest.NewRecorder()
	a.ServeHTTP(rr, req)
	return rr
}
func sessionCookie(t *testing.T, rr *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rr.Result().Cookies() {
		if c.Name == "staff_session" && c.MaxAge > 0 {
			return c
		}
	}
	t.Fatal("staff cookie missing")
	return nil
}
func mustStatus(t *testing.T, rr *httptest.ResponseRecorder, n int) {
	t.Helper()
	if rr.Code != n {
		t.Fatalf("want %d, got %d: %s", n, rr.Code, rr.Body.String())
	}
}
func TestPostgresAPIWorkflow(t *testing.T) {
	store := testStore(t)
	config := Config{Origin: "http://localhost:5173", Secret: strings.Repeat("s", 64)}
	if e := store.BootstrapOwner(context.Background(), "owner", "Test owner", "local-test-password"); e != nil {
		t.Fatal(e)
	}
	a := New(store, config)
	origin := config.Origin
	t.Run("health and menu", func(t *testing.T) {
		mustStatus(t, call(t, a, "GET", "/api/health", nil, nil, ""), 200)
		rr := call(t, a, "GET", "/api/menu", nil, nil, "")
		mustStatus(t, rr, 200)
		if !strings.Contains(rr.Body.String(), "Классическая") {
			t.Fatal("seed menu missing")
		}
	})
	t.Run("staff endpoints are protected", func(t *testing.T) {
		routes := [][2]string{{"GET", "/api/kitchen/orders"}, {"PUT", "/api/kitchen/products/1"}, {"POST", "/api/kitchen/products"}, {"PUT", "/api/kitchen/settings"}, {"PATCH", "/api/kitchen/orders/1"}}
		for _, r := range routes {
			mustStatus(t, call(t, a, r[0], r[1], map[string]string{}, nil, origin), 401)
		}
	})
	t.Run("cross site rejected", func(t *testing.T) {
		mustStatus(t, call(t, a, "POST", "/api/kitchen/login", map[string]string{"username": "owner", "password": "local-test-password"}, nil, "https://attacker.invalid"), 403)
	})
	t.Run("wrong password rejected", func(t *testing.T) {
		mustStatus(t, call(t, a, "POST", "/api/kitchen/login", map[string]string{"password": "wrong"}, nil, origin), 401)
	})
	login := call(t, a, "POST", "/api/kitchen/login", map[string]string{"username": "owner", "password": "local-test-password"}, nil, origin)
	mustStatus(t, login, 200)
	cookies := login.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatal("session cookie missing")
	}
	cookie := sessionCookie(t, login)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/api" {
		t.Fatal("unsafe cookie")
	}
	mustStatus(t, call(t, New(store, config), "GET", "/api/kitchen/session", nil, cookie, ""), 200)
	t.Run("mutation requires origin", func(t *testing.T) {
		mustStatus(t, call(t, a, "PUT", "/api/kitchen/settings", Settings{}, cookie, ""), 403)
	})
	c := checkout()
	c.RequestKey = "11111111-1111-4111-8111-111111111111"
	c.Note = "Без лука"
	created := call(t, a, "POST", "/api/orders", c, nil, origin)
	mustStatus(t, created, 201)
	var order Order
	if e := json.Unmarshal(created.Body.Bytes(), &order); e != nil {
		t.Fatal(e)
	}
	if order.Total != 580 || len(order.Token) != 43 || order.ID < 1 {
		t.Fatalf("bad order: %+v", order)
	}
	token := order.Token
	var storedHash string
	if e := store.DB.QueryRow("SELECT token_hash FROM orders WHERE id=$1", order.ID).Scan(&storedHash); e != nil {
		t.Fatal(e)
	}
	if storedHash == token {
		t.Fatal("raw token stored")
	}
	t.Run("tracking is private", func(t *testing.T) {
		mustStatus(t, call(t, a, "GET", fmt.Sprintf("/api/orders/%d", order.Number), nil, nil, ""), 404)
		mustStatus(t, call(t, a, "GET", "/api/orders/"+strings.Repeat("z", 43), nil, nil, ""), 404)
		rr := call(t, a, "GET", "/api/orders/"+token, nil, nil, "")
		mustStatus(t, rr, 200)
		if strings.Contains(rr.Body.String(), "Михаил") || strings.Contains(rr.Body.String(), "Без лука") || strings.Contains(rr.Body.String(), token) {
			t.Fatal("public tracking discloses private fields")
		}
		if rr.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("tracking cached")
		}
	})
	t.Run("retry does not duplicate", func(t *testing.T) {
		rr := call(t, a, "POST", "/api/orders", c, nil, origin)
		mustStatus(t, rr, 201)
		var retry Order
		_ = json.Unmarshal(rr.Body.Bytes(), &retry)
		if retry.ID != order.ID || retry.Token != token {
			t.Fatal("retry created a duplicate")
		}
		changed := c
		changed.Name = "Другое имя"
		mustStatus(t, call(t, a, "POST", "/api/orders", changed, nil, origin), 409)
	})
	t.Run("price is server checked", func(t *testing.T) {
		changed := checkout()
		changed.RequestKey = "22222222-2222-4222-8222-222222222222"
		changed.Items[0].ExpectedPrice = 1
		mustStatus(t, call(t, a, "POST", "/api/orders", changed, nil, origin), 409)
	})
	products, _ := store.Products(context.Background())
	p := products[0]
	p.Price = 310
	p.Available = false
	mustStatus(t, call(t, a, "PUT", "/api/kitchen/products/1", p, cookie, origin), 200)
	t.Run("availability checked and history retained", func(t *testing.T) {
		unavailable := checkout()
		unavailable.RequestKey = "33333333-3333-4333-8333-333333333333"
		mustStatus(t, call(t, a, "POST", "/api/orders", unavailable, nil, origin), 409)
		old, e := store.Track(context.Background(), token)
		if e != nil {
			t.Fatal(e)
		}
		if old.Total != 580 || old.Items[0].Price != 290 {
			t.Fatal("product edit changed historic order")
		}
	})
	p.Available = true
	mustStatus(t, call(t, a, "PUT", "/api/kitchen/products/1", p, cookie, origin), 200)
	t.Run("pause enforced on server", func(t *testing.T) {
		st := Settings{Paused: true, PrepMinutes: 15, PauseMessage: "Перерыв"}
		mustStatus(t, call(t, a, "PUT", "/api/kitchen/settings", st, cookie, origin), 200)
		fresh := checkout()
		fresh.RequestKey = "44444444-4444-4444-8444-444444444444"
		fresh.Items[0].ExpectedPrice = 310
		mustStatus(t, call(t, a, "POST", "/api/orders", fresh, nil, origin), 409)
		mustStatus(t, call(t, a, "POST", "/api/orders", c, nil, origin), 201)
		st.Paused = false
		mustStatus(t, call(t, a, "PUT", "/api/kitchen/settings", st, cookie, origin), 200)
	})
	route := fmt.Sprintf("/api/kitchen/orders/%d", order.ID)
	t.Run("status and ETA transitions", func(t *testing.T) {
		mustStatus(t, call(t, a, "PATCH", route, OrderUpdate{Status: "completed"}, cookie, origin), 409)
		eta := 22
		mustStatus(t, call(t, a, "PATCH", route, OrderUpdate{Status: "preparing", ETAMinutes: &eta}, cookie, origin), 200)
		tracked, e := store.Track(context.Background(), token)
		if e != nil {
			t.Fatal(e)
		}
		if tracked.Status != "preparing" || time.Until(tracked.EstimatedReadyAt) < 21*time.Minute {
			t.Fatal("ETA or status not saved")
		}
		mustStatus(t, call(t, a, "PATCH", route, OrderUpdate{Status: "ready"}, cookie, origin), 200)
		mustStatus(t, call(t, a, "PATCH", route, OrderUpdate{Status: "new"}, cookie, origin), 409)
		mustStatus(t, call(t, a, "PATCH", route, OrderUpdate{Status: "completed"}, cookie, origin), 200)
	})
	t.Run("new product and invalid product", func(t *testing.T) {
		p.ID = 0
		p.Name = "Новинка"
		mustStatus(t, call(t, a, "POST", "/api/kitchen/products", p, cookie, origin), 200)
		p.Price = -1
		mustStatus(t, call(t, a, "POST", "/api/kitchen/products", p, cookie, origin), 400)
	})
	t.Run("session expiry and logout", func(t *testing.T) {
		_, e := store.DB.Exec("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", Hash(cookie.Value))
		if e != nil {
			t.Fatal(e)
		}
		mustStatus(t, call(t, a, "GET", "/api/kitchen/orders", nil, cookie, ""), 401)
		rr := call(t, a, "POST", "/api/kitchen/login", map[string]string{"username": "owner", "password": "local-test-password"}, nil, origin)
		mustStatus(t, rr, 200)
		cookie = sessionCookie(t, rr)
		mustStatus(t, call(t, a, "POST", "/api/kitchen/logout", map[string]string{}, cookie, origin), 200)
		mustStatus(t, call(t, a, "GET", "/api/kitchen/session", nil, cookie, ""), 401)
	})
	t.Run("login rate limit", func(t *testing.T) {
		for i := 0; i < 12; i++ {
			call(t, a, "POST", "/api/kitchen/login", map[string]string{"password": "wrong"}, nil, origin)
		}
		mustStatus(t, call(t, a, "POST", "/api/kitchen/login", map[string]string{"username": "owner", "password": "local-test-password"}, nil, origin), 429)
	})
}
func TestConcurrentCheckoutIsIdempotent(t *testing.T) {
	s := testStore(t)
	c := checkout()
	ctx := context.Background()
	var wg sync.WaitGroup
	ids := make(chan int64, 12)
	errs := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o, e := s.CreateOrder(ctx, c, "private-token")
			if e != nil {
				errs <- e
			} else {
				ids <- o.ID
			}
		}()
	}
	wg.Wait()
	close(errs)
	close(ids)
	for e := range errs {
		t.Fatal(e)
	}
	var first int64
	for id := range ids {
		if first == 0 {
			first = id
		}
		if id != first {
			t.Fatal("duplicate created under concurrency")
		}
	}
	var count int
	if e := s.DB.QueryRow("SELECT count(*) FROM orders").Scan(&count); e != nil || count != 1 {
		t.Fatalf("order count %d, error %v", count, e)
	}
}
func TestTransactionRollback(t *testing.T) {
	s := testStore(t)
	c := checkout()
	c.Items = append(c.Items, CartItem{ProductID: 999999, Quantity: 1, ExpectedPrice: 100})
	_, e := s.CreateOrder(context.Background(), c, "bad-token")
	if e == nil {
		t.Fatal("missing product accepted")
	}
	var count int
	_ = s.DB.QueryRow("SELECT count(*) FROM orders").Scan(&count)
	if count != 0 {
		t.Fatal("failed checkout partially stored")
	}
	// Verify seeds and edits survive an idempotent second migration.
	_, _ = s.DB.Exec("UPDATE products SET price=123 WHERE id=1")
	if e = s.Migrate(context.Background()); e != nil {
		t.Fatal(e)
	}
	var price int
	_ = s.DB.QueryRow("SELECT price FROM products WHERE id=1").Scan(&price)
	if price != 123 {
		t.Fatal("migration reset staff edit")
	}
}
