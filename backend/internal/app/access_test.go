package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

const testPassword = "test-only-long-password"

func TestAdministrativeOwnerRecovery(t *testing.T) {
	s, a, oldSession := accessFixture(t)
	ctx := context.Background()
	if _, e := s.DB.ExecContext(ctx, "UPDATE staff_accounts SET active=false WHERE username='owner'"); e != nil {
		t.Fatal(e)
	}
	if e := s.RecoverOwner(ctx, "OWNER", "replacement-owner-password"); e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, oldSession, ""), 401)
	loginAccount(t, a, "owner", "replacement-owner-password")
	fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, false)
	if e := s.RecoverOwner(ctx, "worker", testPassword); e != ErrMissing {
		t.Fatalf("recovery must require an existing owner: %v", e)
	}
}

func accessFixture(t *testing.T) (*Store, *API, *http.Cookie) {
	t.Helper()
	s := testStore(t)
	if e := s.BootstrapOwner(context.Background(), "owner", "Owner", testPassword); e != nil {
		t.Fatal(e)
	}
	a := New(s, Config{Origin: "http://localhost:5173", Secret: strings.Repeat("s", 64)})
	return s, a, loginAccount(t, a, "owner", testPassword)
}
func loginAccount(t *testing.T, a *API, username, password string) *http.Cookie {
	t.Helper()
	rr := call(t, a, "POST", "/api/auth/login", map[string]string{"username": username, "password": password}, nil, a.Config.Origin)
	mustStatus(t, rr, 200)
	return sessionCookie(t, rr)
}
func fixtureAccount(t *testing.T, s *Store, username string, memberships []Membership, temporary bool) Account {
	t.Helper()
	hash, e := PasswordHash(testPassword)
	if e != nil {
		t.Fatal(e)
	}
	u, e := s.SaveAccount(context.Background(), 0, UserInput{Username: username, DisplayName: username, Active: true, Memberships: memberships}, hash, temporary)
	if e != nil {
		t.Fatal(e)
	}
	return u
}
func fixtureShop(t *testing.T, a *API, c *http.Cookie) Shop {
	t.Helper()
	rr := call(t, a, "POST", "/api/owner/stores", map[string]string{"slug": "lenskaya-18", "name": "Second shop", "address": "Second address"}, c, a.Config.Origin)
	mustStatus(t, rr, 201)
	var p Shop
	if e := json.Unmarshal(rr.Body.Bytes(), &p); e != nil {
		t.Fatal(e)
	}
	return p
}
func TestRolesAndStoreIsolation(t *testing.T) {
	s, a, owner := accessFixture(t)
	second := fixtureShop(t, a, owner)
	worker := fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, false)
	_ = worker
	fixtureAccount(t, s, "manager", []Membership{{1, "manager"}, {second.ID, "worker"}}, false)
	w := loginAccount(t, a, "worker", testPassword)
	m := loginAccount(t, a, "manager", testPassword)
	for _, tc := range []struct {
		method, path string
		body         any
		cookie       *http.Cookie
		status       int
	}{
		{"GET", "/api/staff/stores/1/orders", nil, w, 200}, {"GET", "/api/staff/stores/2/orders", nil, w, 403},
		{"GET", "/api/owner/users", nil, w, 403}, {"GET", "/api/owner/analytics", nil, m, 403},
		{"GET", "/api/staff/stores/1/analytics", nil, w, 403}, {"GET", "/api/staff/stores/1/analytics", nil, m, 200},
		{"GET", "/api/staff/stores/2/analytics", nil, m, 403}, {"GET", "/api/staff/stores/1/history", nil, w, 403},
		{"PUT", "/api/kitchen/settings", Settings{}, w, 403}, {"POST", "/api/kitchen/products", Product{}, w, 403},
		{"PATCH", "/api/staff/stores/1/operations", map[string]any{"paused": true, "reason": "Busy", "shop_name": "tampered"}, w, 400},
		{"PATCH", "/api/staff/stores/1/products/1/availability", map[string]any{"available": false, "price": 1}, w, 400},
		{"PATCH", "/api/staff/stores/1/products/1/availability", map[string]any{"available": false}, w, 200},
		{"PATCH", "/api/staff/stores/1/operations", map[string]any{"paused": true, "reason": "Busy"}, w, 200},
		{"PATCH", "/api/staff/stores/1/operations", map[string]any{"paused": false}, w, 200},
		{"PATCH", "/api/staff/stores/1/operations", map[string]any{"prep_minutes": 10}, w, 200},
		{"GET", "/api/owner/users", nil, owner, 200},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			mustStatus(t, call(t, a, tc.method, tc.path, tc.body, tc.cookie, a.Config.Origin), tc.status)
		})
	}
	ctx := shopContext(context.Background(), second.ID)
	p := Product{Name: "Other", Price: 300, Image: "/images/classic.jpg", Available: true}
	p, e := s.SaveProduct(ctx, p)
	if e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "PATCH", fmt.Sprintf("/api/staff/stores/1/products/%d/availability", p.ID), map[string]bool{"available": false}, w, a.Config.Origin), 404)
	mustStatus(t, call(t, a, "PUT", fmt.Sprintf("/api/staff/stores/1/products/%d", p.ID), p, m, a.Config.Origin), 404)
	mustStatus(t, call(t, a, "PATCH", "/api/owner/stores/2", map[string]bool{"published": true}, owner, a.Config.Origin), 200)
	c := checkout()
	c.StoreID = second.ID
	c.Items = []CartItem{{ProductID: p.ID, Quantity: 1, ExpectedPrice: 300}}
	c.RequestKey = strings.Repeat("b", 36)
	o, e := s.CreateOrder(ctx, c, a.orderToken(c.RequestKey))
	if e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "PATCH", fmt.Sprintf("/api/staff/stores/1/orders/%d", o.ID), OrderUpdate{Status: "cancelled", CancellationReason: "Forged"}, w, a.Config.Origin), 404)
	mustStatus(t, call(t, a, "PATCH", fmt.Sprintf("/api/staff/stores/2/orders/%d", o.ID), OrderUpdate{Status: "cancelled", CancellationReason: "Unavailable"}, m, a.Config.Origin), 200)
	// Role is evaluated independently for every assigned store.
	rr := call(t, a, "GET", "/api/staff/stores", nil, w, "")
	mustStatus(t, rr, 200)
	if strings.Contains(rr.Body.String(), "Second address") {
		t.Fatal("unassigned store leaked")
	}
}
func TestOwnerStopDoesNotPreventFulfilment(t *testing.T) {
	s, a, owner := accessFixture(t)
	fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, false)
	w := loginAccount(t, a, "worker", testPassword)
	c := checkout()
	o, e := s.CreateOrder(context.Background(), c, a.orderToken(c.RequestKey))
	if e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "PATCH", "/api/owner/stores/1", map[string]any{"owner_stopped": true, "reason": "Maintenance"}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "PATCH", "/api/staff/stores/1/operations", map[string]bool{"paused": false}, w, a.Config.Origin), 403)
	mustStatus(t, call(t, a, "POST", "/api/orders", c, nil, a.Config.Origin), 201)
	c.RequestKey = strings.Repeat("b", 36)
	mustStatus(t, call(t, a, "POST", "/api/orders", c, nil, a.Config.Origin), 409)
	for _, status := range []string{"preparing", "ready", "completed"} {
		mustStatus(t, call(t, a, "PATCH", fmt.Sprintf("/api/staff/stores/1/orders/%d", o.ID), OrderUpdate{Status: status}, w, a.Config.Origin), 200)
	}
	mustStatus(t, call(t, a, "PATCH", "/api/owner/stores/1", map[string]bool{"owner_stopped": false}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "POST", "/api/orders", c, nil, a.Config.Origin), 201)
	mustStatus(t, call(t, a, "PATCH", "/api/owner/stores/1", map[string]bool{"archived": true}, owner, a.Config.Origin), 409)
	public := call(t, a, "GET", "/api/stores", nil, nil, "")
	if strings.Contains(public.Body.String(), "Maintenance") {
		t.Fatal("internal owner stop reason is public")
	}
}
func TestTemporaryPasswordsAndRevocation(t *testing.T) {
	s, a, owner := accessFixture(t)
	u := fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, true)
	w := loginAccount(t, a, "worker", testPassword)
	rr := call(t, a, "GET", "/api/staff/stores/1/orders", nil, w, "")
	mustStatus(t, rr, 403)
	if !strings.Contains(rr.Body.String(), "password_change_required") {
		t.Fatal("temporary account granted business access")
	}
	rr = call(t, a, "POST", "/api/auth/change-password", map[string]string{"current_password": testPassword, "password": "new-test-only-password"}, w, a.Config.Origin)
	mustStatus(t, rr, 200)
	fresh := sessionCookie(t, rr)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, w, ""), 401)
	mustStatus(t, call(t, New(s, a.Config), "GET", "/api/staff/stores/1/orders", nil, fresh, ""), 200)
	mustStatus(t, call(t, a, "POST", fmt.Sprintf("/api/owner/users/%d/reset-password", u.ID), map[string]string{}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, fresh, ""), 401)
	s.DB.Exec("UPDATE staff_accounts SET temporary_until=now()-interval '1 minute' WHERE id=$1", u.ID)
	mustStatus(t, call(t, a, "POST", "/api/auth/login", map[string]string{"username": "worker", "password": "new-test-only-password"}, nil, a.Config.Origin), 401)
	listed := call(t, a, "GET", "/api/owner/users", nil, owner, "")
	if strings.Contains(listed.Body.String(), "password_hash") || strings.Contains(listed.Body.String(), "argon2") {
		t.Fatal("password hashes leaked")
	}
	// Reassigning a permanent account immediately revokes all its sessions.
	v := fixtureAccount(t, s, "other", []Membership{{1, "worker"}}, false)
	vCookie := loginAccount(t, a, "other", testPassword)
	_, e := s.SaveAccount(context.Background(), v.ID, UserInput{Username: v.Username, DisplayName: v.DisplayName, Active: true}, "", false)
	if e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, vCookie, ""), 401)
}
func TestOwnerConfirmationAndLastOwner(t *testing.T) {
	s, a, owner := accessFixture(t)
	users, _ := s.Accounts(context.Background())
	u := users[0]
	mustStatus(t, call(t, a, "PUT", fmt.Sprintf("/api/owner/users/%d", u.ID), UserInput{Username: u.Username, DisplayName: u.DisplayName, Active: false, Owner: true}, owner, a.Config.Origin), 409)
	s.DB.Exec("UPDATE sessions SET confirmed_at=now()-interval '6 minutes'")
	rr := call(t, a, "POST", "/api/owner/users", UserInput{Username: "worker", DisplayName: "Worker", Active: true}, owner, a.Config.Origin)
	mustStatus(t, rr, 403)
	if !strings.Contains(rr.Body.String(), "reauthentication_required") {
		t.Fatal("confirmation not required")
	}
	mustStatus(t, call(t, a, "POST", "/api/auth/reauthenticate", map[string]string{"password": testPassword}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "POST", "/api/owner/users", UserInput{Username: "worker", DisplayName: "Worker", Active: true, Memberships: []Membership{{1, "worker"}}}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "POST", "/api/auth/login", map[string]string{"password": "ignored-legacy-password"}, nil, a.Config.Origin), 401)
}
func TestOwnerCannotIssueTemporaryPasswordToSelf(t *testing.T) {
	s, a, owner := accessFixture(t)
	users, e := s.Accounts(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	u := users[0]
	mustStatus(t, call(t, a, "POST", fmt.Sprintf("/api/owner/users/%d/reset-password", u.ID), map[string]string{}, owner, a.Config.Origin), 409)
	after, e := s.account(context.Background(), u.ID)
	if e != nil || after.Version != u.Version || after.PasswordRequired || !VerifyPassword(after.PasswordHash, testPassword) {
		t.Fatal("self-reset altered owner credentials")
	}
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, owner, ""), 200)
	otherSession := loginAccount(t, a, "owner", testPassword)
	rr := call(t, a, "POST", "/api/auth/change-password", map[string]string{"current_password": testPassword, "password": "personal-owner-new-password"}, owner, a.Config.Origin)
	mustStatus(t, rr, 200)
	currentSession := sessionCookie(t, rr)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, currentSession, ""), 200)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, otherSession, ""), 401)
	loginAccount(t, a, "owner", "personal-owner-new-password")
}
func TestCopyMenuIsIndependentAndIdempotent(t *testing.T) {
	s, a, owner := accessFixture(t)
	second := fixtureShop(t, a, owner)
	payload := map[string]any{"source_store_id": 1, "destination_store_id": second.ID, "product_ids": []int64{1, 2}, "request_key": strings.Repeat("k", 36)}
	first := call(t, a, "POST", "/api/owner/menu-copy", payload, owner, a.Config.Origin)
	mustStatus(t, first, 200)
	repeat := call(t, a, "POST", "/api/owner/menu-copy", payload, owner, a.Config.Origin)
	mustStatus(t, repeat, 200)
	var firstProducts, replayProducts []Product
	json.Unmarshal(first.Body.Bytes(), &firstProducts)
	json.Unmarshal(repeat.Body.Bytes(), &replayProducts)
	if !reflect.DeepEqual(firstProducts, replayProducts) {
		t.Fatal("copy replay changed result")
	}
	products, e := s.Products(shopContext(context.Background(), second.ID))
	if e != nil || len(products) != 2 || products[0].Available {
		t.Fatal("copies not independent/unavailable")
	}
	products[0].Price = 900
	if _, e = s.SaveProduct(shopContext(context.Background(), second.ID), products[0]); e != nil {
		t.Fatal(e)
	}
	original, _ := s.Products(context.Background())
	if original[0].Price != 290 {
		t.Fatal("copy edited source")
	}
	payload["product_ids"] = []int64{3}
	mustStatus(t, call(t, a, "POST", "/api/owner/menu-copy", payload, owner, a.Config.Origin), 409)
	c := checkout()
	c.StoreID = second.ID
	c.RequestKey = strings.Repeat("z", 36)
	mustStatus(t, call(t, a, "POST", "/api/orders", c, nil, a.Config.Origin), 409)
}
func TestStoreRetryAndLegacyFingerprint(t *testing.T) {
	s, a, owner := accessFixture(t)
	second := fixtureShop(t, a, owner)
	c := checkout()
	o, e := s.CreateOrder(context.Background(), c, a.orderToken(c.RequestKey))
	if e != nil {
		t.Fatal(e)
	}
	legacy, _ := json.Marshal(c)
	s.DB.Exec("UPDATE orders SET request_hash=$1 WHERE id=$2", Hash(string(legacy)), o.ID)
	c.StoreID = 1
	rr := call(t, a, "POST", "/api/orders", c, nil, a.Config.Origin)
	mustStatus(t, rr, 201)
	var replay Order
	json.Unmarshal(rr.Body.Bytes(), &replay)
	if replay.ID != o.ID {
		t.Fatal("legacy retry created another order")
	}
	c.StoreID = second.ID
	mustStatus(t, call(t, a, "POST", "/api/orders", c, nil, a.Config.Origin), 409)
	settings, _ := s.Settings(context.Background())
	settings.Address = "Changed address"
	s.SaveSettings(context.Background(), settings)
	tracked, _ := s.Track(context.Background(), a.orderToken(c.RequestKey))
	if tracked.Shop.Address == settings.Address {
		t.Fatal("pickup snapshot changed")
	}
}
func TestAnalyticsCohortTimingAndMoscowBoundary(t *testing.T) {
	s, a, owner := accessFixture(t)
	c := checkout()
	o, e := s.CreateOrder(context.Background(), c, a.orderToken(c.RequestKey))
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE orders SET created_at='2026-10-12T21:00:00Z',status='completed',initial_ready_at='2026-10-12T21:10:00Z' WHERE id=$1", o.ID)
	s.DB.Exec("DELETE FROM order_events WHERE order_id=$1", o.ID)
	s.DB.Exec("INSERT INTO order_events(order_id,store_id,status,created_at) VALUES($1,1,'preparing','2026-10-12T21:05:00Z'),($1,1,'ready','2026-10-12T21:15:00Z')", o.ID)
	c.RequestKey = strings.Repeat("e", 36)
	old, e := s.CreateOrder(context.Background(), c, a.orderToken(c.RequestKey))
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE orders SET created_at='2026-10-13T10:00:00Z',status='completed',initial_ready_at=NULL WHERE id=$1", old.ID)
	s.DB.Exec("DELETE FROM order_events WHERE order_id=$1", old.ID)
	rr := call(t, a, "GET", "/api/owner/analytics?from=2026-10-13&to=2026-10-13", nil, owner, "")
	mustStatus(t, rr, 200)
	var report Analytics
	json.Unmarshal(rr.Body.Bytes(), &report)
	if report.Orders != 2 || report.CompletedValue != 1160 || report.PrepMinutes != 10 || report.PrepSamples != 1 || report.ReadyMinutes != 15 || report.ReadySamples != 1 || report.Late != 1 || report.DeadlineSamples != 1 {
		t.Fatalf("incorrect analytics: %+v", report)
	}
	rr = call(t, a, "GET", "/api/owner/analytics?from=2026-10-12&to=2026-10-12", nil, owner, "")
	mustStatus(t, rr, 200)
	json.Unmarshal(rr.Body.Bytes(), &report)
	if report.Orders != 0 {
		t.Fatal("UTC date leaked into Moscow cohort")
	}
	mustStatus(t, call(t, a, "GET", "/api/owner/analytics?from=2025-01-01&to=2026-10-13", nil, owner, ""), 400)
}
func TestPasswordPolicyAndHash(t *testing.T) {
	for _, password := range []string{"short", strings.Repeat("a", 129)} {
		if _, e := PasswordHash(password); e == nil {
			t.Fatal("weak/oversize password accepted")
		}
	}
	hash, e := PasswordHash("a long passphrase for work")
	if e != nil || !VerifyPassword(hash, "a long passphrase for work") || VerifyPassword(hash, "wrong") {
		t.Fatal("password verification failed")
	}
}
func BenchmarkArgon2Password(b *testing.B) {
	for i := 0; i < b.N; i++ {
		if _, e := PasswordHash("benchmark-only-long-passphrase"); e != nil {
			b.Fatal(e)
		}
	}
}
func TestTemporaryExpiration(t *testing.T) {
	s, a, _ := accessFixture(t)
	u := fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, true)
	s.DB.Exec("UPDATE staff_accounts SET temporary_until=$1 WHERE id=$2", time.Now().Add(-time.Minute), u.ID)
	mustStatus(t, call(t, a, "POST", "/api/auth/login", map[string]string{"username": "worker", "password": testPassword}, nil, a.Config.Origin), 401)
}

func TestUpgradeExistingSingleStoreData(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	ctx := context.Background()
	admin, e := Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.DB.Close()
	schema := fmt.Sprintf("access_upgrade_%d", time.Now().UnixNano())
	if _, e = admin.DB.Exec("CREATE SCHEMA " + schema); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { admin.DB.Exec("DROP SCHEMA " + schema + " CASCADE") })
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, e := Open(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	if _, e = s.DB.Exec("CREATE TABLE schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())"); e != nil {
		t.Fatal(e)
	}
	for _, file := range []string{"schema.sql", "migrations/002_shop.sql"} {
		body, _ := migrations.ReadFile(file)
		if _, e = s.DB.Exec(string(body)); e != nil {
			t.Fatal(e)
		}
		s.DB.Exec("INSERT INTO schema_migrations(version) VALUES($1)", file)
	}
	s.DB.Exec("UPDATE settings SET shop_name='Staff edited shop',address='Original pickup',demo_mode=false,prep_minutes=20 WHERE id=1")
	s.DB.Exec("UPDATE products SET name='Legacy item',price=310 WHERE id=1")
	c := checkout()
	c.Items[0].ExpectedPrice = 310
	payload, _ := json.Marshal(c)
	items := []OrderItem{{ProductID: 1, Name: "Legacy item", Price: 310, Quantity: 2, Options: []ProductOption{}}}
	_, e = s.DB.Exec("INSERT INTO orders(token_hash,request_key,request_hash,customer_name,note,total,items,estimated_ready_at,status) VALUES($1,$2,$3,$4,'legacy note',620,$5,now(),'completed')", Hash("legacy-token"), c.RequestKey, Hash(string(payload)), c.Name, mustJSON(items))
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("INSERT INTO sessions(token_hash,expires_at) VALUES('old-session',now()+interval '1 hour')")
	if e = s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	products, e := s.Products(ctx)
	if e != nil || len(products) != 3 || products[0].ID != 1 || products[0].Price != 310 {
		t.Fatal("migration changed products")
	}
	st, e := s.Settings(ctx)
	if e != nil || st.ShopName != "Staff edited shop" || st.Address != "Original pickup" || st.PrepMinutes != 20 || st.DemoMode {
		t.Fatal("migration reset staff settings")
	}
	o, e := s.Track(ctx, "legacy-token")
	if e != nil || o.Number != 101 || o.Total != 620 || o.Items[0].Name != "Legacy item" || o.StoreID != 1 || o.Shop.Address != "Original pickup" {
		t.Fatal("migration changed receipt or private lookup")
	}
	var count int
	s.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&count)
	if count != 0 {
		t.Fatal("legacy sessions were retained")
	}
	s.DB.QueryRow("SELECT count(*) FROM order_events").Scan(&count)
	if count != 0 {
		t.Fatal("migration fabricated old timing events")
	}
	s.DB.QueryRow("SELECT count(*) FROM staff_accounts").Scan(&count)
	if count != 0 {
		t.Fatal("migration promoted a shared login")
	}
	replay, e := s.CreateOrder(ctx, c, "legacy-token")
	if e != nil || replay.Number != 101 {
		t.Fatal("migration invalidated the exact legacy retry")
	}
}

func TestArchivedAssignmentsCanStillBeRevoked(t *testing.T) {
	s, a, owner := accessFixture(t)
	u := fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, false)
	cookie := loginAccount(t, a, "worker", testPassword)
	mustStatus(t, call(t, a, "PATCH", "/api/owner/stores/1", map[string]bool{"archived": true}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "PATCH", "/api/staff/stores/1/products/1/availability", map[string]bool{"available": false}, cookie, a.Config.Origin), 403)
	mustStatus(t, call(t, a, "PUT", fmt.Sprintf("/api/owner/users/%d", u.ID), UserInput{Username: u.Username, DisplayName: u.DisplayName, Active: false, Memberships: u.Memberships}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, cookie, ""), 401)
}
