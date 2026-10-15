package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testOperator() Operator {
	return Operator{Kind: "company", LegalName: "Fixture operator (not a real business)", INN: "1234567890", Registration: "1234567890123", Address: "Isolated test database", Contact: "privacy@example.invalid", Contractors: "Fixture hosting only", Locations: "Disposable local test system", StaffBasis: "Fixture accounts only", Approved: true}
}
func problemStatus(t *testing.T, e error, status int) {
	t.Helper()
	var p *Problem
	if !errors.As(e, &p) || p.Status != status {
		t.Fatalf("expected problem %d, got %v", status, e)
	}
}
func privacyOwnerSession(t *testing.T, s *Store) (*API, *http.Cookie) {
	t.Helper()
	a := New(s, Config{Origin: "http://localhost:5173", Secret: s.PrivacyKey})
	if e := s.BootstrapOwner(context.Background(), "owner", "Fixture owner", testPassword); e != nil {
		t.Fatal(e)
	}
	rr := call(t, a, "POST", "/api/auth/login", map[string]string{"username": "owner", "password": testPassword}, nil, a.Config.Origin)
	mustStatus(t, rr, 200)
	if _, e := s.DB.Exec("UPDATE sessions SET confirmed_at=now()-interval '6 minutes'"); e != nil {
		t.Fatal(e)
	}
	return a, sessionCookie(t, rr)
}
func TestPrivacyPublicationAndCheckout(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, owner := privacyOwnerSession(t, s)
	if _, e := s.DB.Exec("UPDATE privacy_settings SET current_version=NULL,draft='{}'"); e != nil {
		t.Fatal(e)
	}
	p, e := s.Privacy(ctx)
	if e != nil || p.Current != nil || p.Draft.LegalName != "" {
		t.Fatal("operator inferred or not blank", e)
	}
	menu := call(t, a, "GET", "/api/menu", nil, nil, "")
	if !strings.Contains(menu.Body.String(), `"accepting_orders":false`) {
		t.Fatal("unconfigured intake open")
	}
	c := checkout()
	_, e = s.CreateOrder(ctx, c, strings.Repeat("u", 43))
	problemStatus(t, e, 409)
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/publish", map[string]int{"revision": 1}, owner, a.Config.Origin), 403)
	mustStatus(t, call(t, a, "POST", "/api/auth/reauthenticate", map[string]string{"password": testPassword}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/publish", map[string]int{"revision": 1}, owner, a.Config.Origin), 400)
	mustStatus(t, call(t, a, "PUT", "/api/owner/privacy/draft", map[string]any{"draft": testOperator(), "revision": 1}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/publish", map[string]int{"revision": 1}, owner, a.Config.Origin), 409)
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/publish", map[string]int{"revision": 2}, owner, a.Config.Origin), 200)
	p, _ = s.Privacy(ctx)
	v := p.Current.ID
	c.Privacy = &PrivacyChoice{NoticeVersion: v}
	_, e = s.CreateOrder(ctx, c, strings.Repeat("u", 43))
	problemStatus(t, e, 400)
	c.Name = ""
	c.Note = ""
	o, e := s.CreateOrder(ctx, c, strings.Repeat("u", 43))
	if e != nil || o.Name != "" {
		t.Fatal("number-only checkout failed", e)
	}
	// Accepted retries precede document/readiness checks, including genuine legacy JSON fingerprints.
	legacy := c
	legacy.Privacy = nil
	legacy.StoreID = 0
	s.DB.Exec("UPDATE orders SET request_hash=$1 WHERE id=$2", Hash(string(mustJSON(legacy))), o.ID)
	s.DB.Exec("UPDATE privacy_settings SET current_version=NULL")
	if retry, e := s.CreateOrder(ctx, legacy, strings.Repeat("u", 43)); e != nil || retry.ID != o.ID {
		t.Fatal("legacy accepted retry rejected", e)
	}
	s.DB.Exec("UPDATE privacy_settings SET current_version=$1", v)
	c.RequestKey = strings.Repeat("b", 36)
	c.Name = "Guest"
	c.Privacy = &PrivacyChoice{NoticeVersion: v, ConsentVersion: v, Accepted: true}
	optional, e := s.CreateOrder(ctx, c, strings.Repeat("v", 43))
	if e != nil {
		t.Fatal(e)
	}
	var evidence int
	s.DB.QueryRow("SELECT count(*) FROM privacy_evidence WHERE order_ref=$1 AND purpose='optional_name_preparation' AND version_id=$2 AND accepted", optional.ID, v).Scan(&evidence)
	if evidence != 1 {
		t.Fatal("missing consent evidence")
	}
	if _, e = s.DB.Exec("UPDATE privacy_versions SET policy='changed' WHERE id=$1", v); e == nil {
		t.Fatal("published document mutable")
	}
	original := p.Current.Policy
	mustStatus(t, call(t, a, "PUT", "/api/owner/privacy/draft", map[string]any{"draft": testOperator(), "revision": 3}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/publish", map[string]int{"revision": 4}, owner, a.Config.Origin), 200)
	if old, e := scanPrivacy(s.DB.QueryRow("SELECT "+privacyCols+" FROM privacy_versions WHERE id=$1", v)); e != nil || old.Policy != original {
		t.Fatal("old publication changed")
	}
	c.RequestKey = strings.Repeat("c", 36)
	_, e = s.CreateOrder(ctx, c, strings.Repeat("w", 43))
	problemStatus(t, e, 409)
	c.RequestKey = strings.Repeat("b", 36)
	if retry, e := s.CreateOrder(ctx, c, strings.Repeat("v", 43)); e != nil || retry.ID != optional.ID {
		t.Fatal("lost-response retry across policy update", e)
	}
}

func TestPrivacyRetentionAndArchive(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, owner := privacyOwnerSession(t, s)
	now := time.Now().UTC()
	created := now.AddDate(-1, 0, -2)
	ids := []int64{}
	checkouts := []Checkout{}
	for i := 0; i < 5; i++ {
		c := checkout()
		c.RequestKey = fmt.Sprintf("privacy-boundary-%032d", i)
		c.Note = "Private preparation"
		checkouts = append(checkouts, c)
		o, e := s.CreateOrder(ctx, c, fmt.Sprintf("%043d", i))
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, o.ID)
		if i == 4 {
			continue
		} // Active orders never expire.
		status := "completed"
		if i == 3 {
			status = "cancelled"
		}
		closed := now.Add(-7*24*time.Hour - time.Minute)
		if i < 2 {
			closed = now.AddDate(-1, 0, 0).Add(-time.Minute)
		}
		if i == 3 {
			closed = now.Add(-7*24*time.Hour + time.Minute)
		}
		if _, e = s.DB.Exec("UPDATE orders SET status=$1,closed_at=$2,created_at=$3,initial_ready_at=$4,cancellation_reason='private cancellation' WHERE id=$5", status, closed, created, created.Add(20*time.Minute), o.ID); e != nil {
			t.Fatal(e)
		}
		if i < 2 {
			for _, event := range []struct {
				s string
				d time.Duration
			}{{"preparing", 2 * time.Minute}, {"ready", time.Duration(10+i*10) * time.Minute}} {
				s.DB.Exec("INSERT INTO order_events(order_id,store_id,status,created_at) VALUES($1,1,$2,$3)", o.ID, event.s, created.Add(event.d))
			}
		}
	}
	s.DB.Exec("INSERT INTO audit_events(staff_name,action,resource,details) VALUES('staff','order.update',$1,'{\"cancellation_reason\":\"private copy\"}')", fmt.Sprint(ids[2]))
	p, e := s.RetentionPreview(ctx)
	if e != nil || p.Receipts != 2 || p.PersonalFields != 3 {
		t.Fatal("wrong preview", p, e)
	}
	if _, e = s.PrivacyMaintenance(ctx, 10); e == nil {
		t.Fatal("cleanup activated implicitly")
	}
	s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true")
	report := func() Analytics {
		t.Helper()
		rr := call(t, a, "GET", "/api/owner/analytics?from="+created.In(time.FixedZone("MSK", 10800)).Format("2006-01-02")+"&to="+created.In(time.FixedZone("MSK", 10800)).Format("2006-01-02"), nil, owner, "")
		mustStatus(t, rr, 200)
		var r Analytics
		if e := json.Unmarshal(rr.Body.Bytes(), &r); e != nil {
			t.Fatal(e)
		}
		return r
	}
	before := report()
	if n, e := s.PrivacyMaintenance(ctx, 10); e != nil || n != 3 {
		t.Fatal("cleanup failed", n, e)
	}
	after := report()
	if string(mustJSON(before)) != string(mustJSON(after)) {
		t.Fatalf("archive changed metrics: before=%s after=%s", mustJSON(before), mustJSON(after))
	}
	if after.PrepSamples != 2 || after.ReadySamples != 2 || after.PrepMinutes != 13 {
		t.Fatal("weighted timings changed", after)
	}
	_, e = s.Track(ctx, fmt.Sprintf("%043d", 0))
	problemStatus(t, e, 410)
	_, e = s.CreateOrder(ctx, checkouts[0], fmt.Sprintf("%043d", 0))
	problemStatus(t, e, 410)
	c := checkouts[0]
	c.StoreID = 2 // No second store: a forged store cannot create anything.
	_, e = s.CreateOrder(ctx, c, fmt.Sprintf("%043d", 0))
	if e == nil {
		t.Fatal("expired retry created order at another store")
	}
	var name, note, reason string
	s.DB.QueryRow("SELECT customer_name,note,cancellation_reason FROM orders WHERE id=$1", ids[2]).Scan(&name, &note, &reason)
	if name+note+reason != "" {
		t.Fatal("personal fields survived")
	}
	var audit string
	s.DB.QueryRow("SELECT details::text FROM audit_events WHERE resource=$1 AND action='order.update'", fmt.Sprint(ids[2])).Scan(&audit)
	if audit != "{}" {
		t.Fatal("audit copy survived")
	}
	for _, id := range ids[3:] {
		s.DB.QueryRow("SELECT customer_name FROM orders WHERE id=$1", id).Scan(&name)
		if name == "" {
			t.Fatal("retained or active order erased")
		}
	}
	if retry, e := s.CreateOrder(ctx, checkouts[2], fmt.Sprintf("%043d", 2)); e != nil || retry.ID != ids[2] || retry.Name != "" {
		t.Fatal("retry after erasure broke", e)
	}
	if n, e := s.PrivacyMaintenance(ctx, 10); e != nil || n != 0 {
		t.Fatal("cleanup not idempotent", n, e)
	}
	// Simulate a restored personal field and missing DB-side destruction record: the external file wins.
	s.DB.Exec("UPDATE orders SET customer_name='restored private data',personal_erased_at=NULL WHERE id=$1", ids[2])
	s.DB.Exec("DELETE FROM privacy_destructions")
	if _, e = s.ReplayPrivacyJournal(ctx); e != nil {
		t.Fatal(e)
	}
	s.DB.QueryRow("SELECT customer_name FROM orders WHERE id=$1", ids[2]).Scan(&name)
	if name != "" {
		t.Fatal("restore resurrected erased field")
	}
	if string(mustJSON(after)) != string(mustJSON(report())) {
		t.Fatal("replay duplicated aggregates")
	}
	if n, e := s.ReplayPrivacyJournal(ctx); e != nil || n != 0 {
		t.Fatal("replay not idempotent", n, e)
	}
	raw, e := os.ReadFile(s.JournalPath)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(raw), "Private preparation") || strings.Contains(string(raw), checkouts[0].RequestKey) {
		t.Fatal("journal contains customer content")
	}
	raw[10] ^= 1
	os.WriteFile(s.JournalPath, raw, 0600)
	if _, e = s.ReplayPrivacyJournal(ctx); e == nil {
		t.Fatal("tampered journal accepted")
	}
}

func TestPrivacyRightsAuthorization(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, owner := privacyOwnerSession(t, s)
	origin := a.Config.Origin
	o, e := s.CreateOrder(ctx, checkout(), strings.Repeat("q", 43))
	if e != nil {
		t.Fatal(e)
	}
	data := map[string]any{"order_id": o.ID, "store_id": 1, "kind": "withdrawal"}
	for _, role := range []string{"worker", "manager"} {
		fixtureAccount(t, s, "privacy-"+role, []Membership{{1, role}}, false)
		cookie := loginAccount(t, a, "privacy-"+role, testPassword)
		for _, route := range []struct {
			method, path string
			body         any
		}{{"GET", "/api/owner/privacy", nil}, {"PUT", "/api/owner/privacy/draft", map[string]any{}}, {"POST", "/api/owner/privacy/publish", map[string]any{}}, {"GET", "/api/owner/privacy/retention", nil}, {"POST", "/api/owner/privacy/retention", map[string]any{}}, {"GET", "/api/owner/privacy/requests", nil}, {"GET", "/api/owner/privacy/destructions", nil}, {"POST", "/api/owner/privacy/requests", data}, {"POST", "/api/owner/privacy/requests/1", map[string]string{"action": "erase"}}} {
			mustStatus(t, call(t, a, route.method, route.path, route.body, cookie, origin), 403)
		}
	}
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/requests", data, nil, origin), 401)
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/requests", data, owner, origin), 403)
	mustStatus(t, call(t, a, "POST", "/api/auth/reauthenticate", map[string]string{"password": testPassword}, owner, origin), 200)
	data["store_id"] = 2
	mustStatus(t, call(t, a, "POST", "/api/owner/privacy/requests", data, owner, origin), 404)
	data["store_id"] = 1
	rr := call(t, a, "POST", "/api/owner/privacy/requests", data, owner, origin)
	mustStatus(t, rr, 201)
	var result struct {
		ID int64 `json:"id"`
	}
	json.Unmarshal(rr.Body.Bytes(), &result)
	path := fmt.Sprintf("/api/owner/privacy/requests/%d", result.ID)
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "export"}, owner, origin), 409)
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "verify", "verification": "in_person"}, owner, origin), 200)
	journal := s.JournalPath
	s.JournalPath = ""
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "erase"}, owner, origin), 503)
	s.JournalPath = journal
	var preserved string
	s.DB.QueryRow("SELECT customer_name FROM orders WHERE id=$1", o.ID).Scan(&preserved)
	if preserved == "" {
		t.Fatal("failed journal write still erased data")
	}
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "block"}, owner, origin), 200)
	orders, e := s.Orders(ctx)
	if e != nil || orders[0].Name != "" {
		t.Fatal("blocked field leaked", e)
	}
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "correct", "name": "Corrected"}, owner, origin), 200)
	rr = call(t, a, "POST", path, map[string]string{"action": "export"}, owner, origin)
	mustStatus(t, rr, 200)
	if !strings.Contains(rr.Body.String(), "Corrected") {
		t.Fatal("verified export missing field")
	}
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "erase"}, owner, origin), 200)
	tracked, e := s.Track(ctx, strings.Repeat("q", 43))
	if e != nil || tracked.Status != "new" {
		t.Fatal("erasure cancelled order")
	}
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "correct", "name": "Restored"}, owner, origin), 409)
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "resolve"}, owner, origin), 200)
	mustStatus(t, call(t, a, "GET", "/api/owner/privacy/destructions", nil, owner, ""), 200)
	mustStatus(t, call(t, a, "POST", path, map[string]string{"action": "export"}, owner, origin), 409)
	var count int
	s.DB.QueryRow("SELECT count(*) FROM audit_events WHERE details::text LIKE '%Corrected%'").Scan(&count)
	if count != 0 {
		t.Fatal("erased content copied to audit")
	}
}

func TestPrivacyStaffAndAuxiliaryRetention(t *testing.T) {
	s, a, owner := accessFixture(t)
	ctx := context.Background()
	u := fixtureAccount(t, s, "disabled-staff", []Membership{{1, "worker"}}, false)
	_, e := s.DB.Exec("UPDATE staff_accounts SET phone='private phone',email='private@example.invalid',active=false WHERE id=$1", u.ID)
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE staff_accounts SET disabled_at=now()-interval '91 days' WHERE id=$1", u.ID)
	s.DB.Exec("INSERT INTO audit_events(staff_name,actor_id,action,resource,details) VALUES('disabled-staff',$1,'account.save',$2,'{\"username\":\"disabled-staff\"}')", u.ID, fmt.Sprint(u.ID))
	s.DB.Exec("INSERT INTO rate_limits(key,window_start) VALUES('old',now()-interval '24 hours'),('current',now())")
	s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true")
	if _, e = s.PrivacyMaintenance(ctx, 1); e != nil {
		t.Fatal(e)
	}
	var username, name, phone, email string
	if e = s.DB.QueryRow("SELECT username,display_name,phone,email FROM staff_accounts WHERE id=$1", u.ID).Scan(&username, &name, &phone, &email); e != nil {
		t.Fatal(e)
	}
	if phone+email != "" || username != "~removed:"+fmt.Sprint(u.ID) {
		t.Fatal("disabled identity survived")
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM rate_limits WHERE key='old'").Scan(&n)
	if n != 0 {
		t.Fatal("old security counter survived")
	}
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, owner, ""), 200)
	var details string
	s.DB.QueryRow("SELECT details::text FROM audit_events WHERE actor_id=$1", u.ID).Scan(&details)
	if details != "{}" {
		t.Fatal("account audit copy survived")
	}
	// Later contact edits while still disabled become eligible again.
	s.DB.Exec("UPDATE staff_accounts SET phone='late contact' WHERE id=$1", u.ID)
	if _, e = s.PrivacyMaintenance(ctx, 1); e != nil {
		t.Fatal(e)
	}
	s.DB.QueryRow("SELECT phone FROM staff_accounts WHERE id=$1", u.ID).Scan(&phone)
	if phone != "" {
		t.Fatal("later disabled contact edit evaded cleanup")
	}
}

func TestPrivacyMaintenanceConcurrency(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true")
	o, e := s.CreateOrder(ctx, checkout(), strings.Repeat("z", 43))
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE orders SET status='completed',closed_at=now()-interval '2 years' WHERE id=$1", o.ID)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = s.PrivacyMaintenance(ctx, 1) }()
	}
	wg.Wait()
	var count int
	s.DB.QueryRow("SELECT COALESCE(sum(orders),0) FROM analytics_archive").Scan(&count)
	if count != 1 {
		t.Fatal("concurrent cleanup double counted", count)
	}
}

func TestPrivacyExpiryDuringCheckoutRetries(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c := checkout()
	token := strings.Repeat("j", 43)
	o, e := s.CreateOrder(ctx, c, token)
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE orders SET status='completed',closed_at=now()-interval '2 years' WHERE id=$1", o.ID)
	s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true")
	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make(chan error, 20)
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			retry, err := s.CreateOrder(ctx, c, token)
			if err == nil && retry.ID != o.ID {
				errs <- fmt.Errorf("duplicate created")
			}
			if err != nil {
				var p *Problem
				if !errors.As(err, &p) || p.Status != 410 {
					errs <- err
				}
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		_, err := s.PrivacyMaintenance(ctx, 10)
		if err != nil {
			errs <- err
		}
	}()
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM orders").Scan(&n)
	if n != 0 {
		t.Fatal("expired retry recreated receipt")
	}
	s.DB.QueryRow("SELECT sum(orders) FROM analytics_archive").Scan(&n)
	if n != 1 {
		t.Fatal("expiry counted more than once")
	}
}

func TestPrivacyRetentionBoundariesAndArchivedStore(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	var second, product int64
	if e := s.DB.QueryRow("INSERT INTO stores(slug,published) VALUES('archived-retention-fixture',true) RETURNING id").Scan(&second); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec("INSERT INTO settings(id) VALUES($1)", second); e != nil {
		t.Fatal(e)
	}
	if e := s.DB.QueryRow("INSERT INTO products(name,description,price,image,store_id) VALUES('Fixture dish','',290,'/images/classic.jpg',$1) RETURNING id", second).Scan(&product); e != nil {
		t.Fatal(e)
	}
	refs := []struct {
		closed          time.Time
		expired, erased bool
	}{
		{now.Add(-7*24*time.Hour - time.Minute), false, true},
		{now.Add(-7*24*time.Hour + time.Minute), false, false},
		{now.AddDate(-1, 0, 0).Add(-time.Minute), true, true},
		{now.AddDate(-1, 0, 0).Add(time.Minute), false, true},
	}
	ids := []int64{}
	for i, tc := range refs {
		c := checkout()
		c.StoreID = second
		c.Items[0].ProductID = product
		c.RequestKey = fmt.Sprintf("boundary-%032d", i)
		o, e := s.CreateOrder(ctx, c, fmt.Sprintf("%043d", i))
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, o.ID)
		if _, e = s.DB.Exec("UPDATE orders SET status='completed',closed_at=$1,initial_ready_at=NULL WHERE id=$2", tc.closed, o.ID); e != nil {
			t.Fatal(e)
		}
	}
	s.DB.Exec("UPDATE stores SET archived=true,published=false WHERE id=$1", second)
	s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true")
	if _, e := s.PrivacyMaintenance(ctx, 10); e != nil {
		t.Fatal(e)
	}
	for i, tc := range refs {
		var name string
		var erased *time.Time
		e := s.DB.QueryRow("SELECT customer_name,personal_erased_at FROM orders WHERE id=$1", ids[i]).Scan(&name, &erased)
		if tc.expired {
			if e == nil {
				t.Fatal("year-old archived receipt survived")
			}
			continue
		}
		if e != nil {
			t.Fatal(e)
		}
		if tc.erased != (erased != nil) || tc.erased != (name == "") {
			t.Fatal("retention boundary crossed early/late", i)
		}
	}
	var samples int
	s.DB.QueryRow("SELECT sum(prep_samples+ready_samples) FROM analytics_archive WHERE store_id=$1", second).Scan(&samples)
	if samples != 0 {
		t.Fatal("invented historical timing")
	}
}

func TestPrivacyBackupRestore(t *testing.T) {
	if _, e := exec.LookPath("pg_dump"); e != nil {
		t.Skip("PostgreSQL client required for full dump/restore rehearsal")
	}
	version, e := exec.Command("pg_dump", "--version").Output()
	if e != nil {
		t.Fatal(e)
	}
	var major int
	if _, e = fmt.Sscanf(string(version), "pg_dump (PostgreSQL) %d", &major); e != nil || major < 17 {
		t.Skip("PostgreSQL 17+ client required for dump/restore of the fixture server")
	}
	s := testStore(t)
	ctx := context.Background()
	var schema string
	if e := s.DB.QueryRow("SELECT current_schema()").Scan(&schema); e != nil {
		t.Fatal(e)
	}
	c := checkout()
	o, e := s.CreateOrder(ctx, c, strings.Repeat("x", 43))
	if e != nil {
		t.Fatal(e)
	}
	c.RequestKey = strings.Repeat("y", 36)
	retained, e := s.CreateOrder(ctx, c, strings.Repeat("y", 43))
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE orders SET status='completed',closed_at=now()-interval '2 years' WHERE id=$1", o.ID)
	s.DB.Exec("UPDATE orders SET status='cancelled',closed_at=now()-interval '8 days' WHERE id=$1", retained.ID)
	s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true")
	dump := filepath.Join(t.TempDir(), "isolated.dump")
	dsn := os.Getenv("TEST_DATABASE_URL")
	if e = exec.CommandContext(ctx, "pg_dump", "--dbname", dsn, "--schema", schema, "--format=custom", "--file", dump).Run(); e != nil {
		t.Fatal("isolated backup failed", e)
	}
	if _, e = s.PrivacyMaintenance(ctx, 100); e != nil {
		t.Fatal(e)
	}
	if e = exec.CommandContext(ctx, "pg_restore", "--dbname", dsn, "--clean", "--if-exists", "--no-owner", "--exit-on-error", dump).Run(); e != nil {
		t.Fatal("isolated restore failed", e)
	}
	// Drop stale prepared statements after replacing the schema, just as a stopped app would.

	s.DB.Close()
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	restored, e := Open(ctx, u.String())
	if e != nil {
		t.Fatal(e)
	}
	s.DB = restored.DB

	if _, e = s.ReplayPrivacyJournal(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = s.PrivacyMaintenance(ctx, 100); e != nil {
		t.Fatal(e)
	}
	_, e = s.Track(ctx, strings.Repeat("x", 43))
	problemStatus(t, e, 410)
	var name string
	s.DB.QueryRow("SELECT customer_name FROM orders WHERE id=$1", retained.ID).Scan(&name)
	if name != "" {
		t.Fatal("restore resurrected optional data")
	}
	var n int
	s.DB.QueryRow("SELECT sum(orders) FROM analytics_archive").Scan(&n)
	if n != 1 {
		t.Fatal("restore double counted archive", n)
	}
}
