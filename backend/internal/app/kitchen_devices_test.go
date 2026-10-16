package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func sharedFixture(t *testing.T, a *API, owner *http.Cookie, sid int64, username string) (Account, string) {
	t.Helper()
	rr := call(t, a, "PUT", fmt.Sprintf("/api/owner/stores/%d/kitchen-access", sid), map[string]any{"username": username, "active": true}, owner, a.Config.Origin)
	mustStatus(t, rr, 200)
	var out struct {
		Account  Account `json:"account"`
		Password string  `json:"password"`
	}
	if e := json.Unmarshal(rr.Body.Bytes(), &out); e != nil {
		t.Fatal(e)
	}
	if len(out.Password) < 15 {
		t.Fatal("one-time credential missing")
	}
	return out.Account, out.Password
}
func deviceCookieFrom(t *testing.T, rr *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rr.Result().Cookies() {
		if c.Name == "kitchen_device" {
			if !c.HttpOnly || c.Path != "/api" || c.SameSite != http.SameSiteStrictMode {
				t.Fatal("unsafe device cookie")
			}
			return c
		}
	}
	t.Fatal("device cookie missing")
	return nil
}
func requestCookies(t *testing.T, a *API, method, path string, body any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", a.Config.Origin)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	rr := httptest.NewRecorder()
	a.ServeHTTP(rr, r)
	return rr
}
func approveKitchen(t *testing.T, s *Store, a *API, owner *http.Cookie, username, password string) (*http.Cookie, *http.Cookie, int64) {
	t.Helper()
	rr := call(t, a, "POST", "/api/auth/login", map[string]string{"username": username, "password": password, "device_label": "Synthetic kitchen tablet"}, nil, a.Config.Origin)
	mustStatus(t, rr, 202)
	device := deviceCookieFrom(t, rr)
	mustStatus(t, call(t, a, "GET", "/api/staff/stores/1/orders", nil, device, ""), 401)
	var id int64
	if e := s.DB.QueryRow("SELECT id FROM kitchen_devices WHERE secret_hash=$1", Hash(device.Value)).Scan(&id); e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "POST", fmt.Sprintf("/api/owner/kitchen-devices/%d", id), map[string]string{"action": "approve"}, owner, a.Config.Origin), 200)
	rr = call(t, a, "POST", "/api/auth/device-session", map[string]string{}, device, a.Config.Origin)
	mustStatus(t, rr, 200)
	return device, sessionCookie(t, rr), id
}
func alertCall(a *API, token, method, path string, body any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	a.ServeHTTP(rr, r)
	return rr
}
func TestSharedKitchenDeviceIsolationAndRevocation(t *testing.T) {
	s, a, owner := accessFixture(t)
	u, password := sharedFixture(t, a, owner, 1, "belorusskaya-kitchen")
	device, staff, did := approveKitchen(t, s, a, owner, u.Username, password)
	mustStatus(t, call(t, a, "GET", "/api/staff/stores/1/orders", nil, staff, ""), 200)
	mustStatus(t, call(t, a, "GET", "/api/owner/users", nil, staff, ""), 403)
	mustStatus(t, call(t, a, "GET", "/api/staff/stores/2/orders", nil, staff, ""), 403)
	mustStatus(t, call(t, a, "PUT", "/api/staff/stores/1/settings", map[string]any{}, staff, a.Config.Origin), 403)
	mustStatus(t, call(t, a, "POST", "/api/auth/change-password", map[string]string{"current_password": password, "password": testPassword}, staff, a.Config.Origin), 403)
	rr := call(t, a, "POST", "/api/kitchen-device/native-token", map[string]string{}, staff, a.Config.Origin)
	mustStatus(t, rr, 200)
	var native struct {
		Token string `json:"token"`
	}
	json.Unmarshal(rr.Body.Bytes(), &native)
	mustStatus(t, alertCall(a, native.Token, "GET", "/api/kitchen-device/alerts", nil), 200)
	// An alert credential cannot authenticate a full-order or privileged API.
	mustStatus(t, alertCall(a, native.Token, "GET", "/api/staff/stores/1/orders", nil), 401)
	c := checkout()
	c.Name = "Private guest"
	c.Note = "Private comment"
	if _, e := s.CreateOrder(context.Background(), c, a.orderToken(c.RequestKey)); e != nil {
		t.Fatal(e)
	}
	feed := alertCall(a, native.Token, "GET", "/api/kitchen-device/alerts?store_id=2", nil)
	mustStatus(t, feed, 200)
	if !strings.Contains(feed.Body.String(), `"number":101`) || strings.Contains(feed.Body.String(), "customer") || strings.Contains(feed.Body.String(), "items") {
		t.Fatal("feed has wrong scope or too much data")
	}
	mustStatus(t, alertCall(a, native.Token, "POST", "/api/kitchen-device/heartbeat", map[string]any{"monitoring": true, "audio_ready": true, "volume": 80, "connection_ok": true, "app_version": "test"}), 200)
	coverage := call(t, a, "GET", "/api/owner/kitchen-access", nil, owner, "")
	mustStatus(t, coverage, 200)
	if !strings.Contains(coverage.Body.String(), `"healthy":true`) {
		t.Fatal("healthy device missing from owner coverage")
	}
	if _, e := s.DB.Exec("UPDATE kitchen_devices SET last_seen_at=now()-interval '61 seconds' WHERE id=$1", did); e != nil {
		t.Fatal(e)
	}
	coverage = call(t, a, "GET", "/api/owner/kitchen-access", nil, owner, "")
	if strings.Contains(coverage.Body.String(), `"online":true`) {
		t.Fatal("stale device still online")
	}
	// Losing kitchen coverage is informational, never a hidden intake stop.
	c.RequestKey = strings.Repeat("h", 36)
	if _, e := s.CreateOrder(context.Background(), c, a.orderToken(c.RequestKey)); e != nil {
		t.Fatal("offline device blocked intake", e)
	}
	mustStatus(t, call(t, a, "POST", fmt.Sprintf("/api/owner/kitchen-devices/%d", did), map[string]string{"action": "revoke"}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, staff, ""), 401)
	mustStatus(t, call(t, a, "POST", "/api/auth/refresh", map[string]string{}, device, a.Config.Origin), 401)
	mustStatus(t, alertCall(a, native.Token, "GET", "/api/kitchen-device/alerts", nil), 401)
}
func TestSharedKitchenExpirySwitchingAndPasswordReset(t *testing.T) {
	s, a, owner := accessFixture(t)
	first, password := sharedFixture(t, a, owner, 1, "first-kitchen")
	secondStore := fixtureShop(t, a, owner)
	second, p2 := sharedFixture(t, a, owner, secondStore.ID, "second-kitchen")
	device, old, did := approveKitchen(t, s, a, owner, first.Username, password)
	issued := call(t, a, "POST", "/api/kitchen-device/native-token", map[string]string{}, old, a.Config.Origin)
	mustStatus(t, issued, 200)
	var previousNative struct {
		Token string `json:"token"`
	}
	if e := json.Unmarshal(issued.Body.Bytes(), &previousNative); e != nil {
		t.Fatal(e)
	}
	// Refresh survives cold starts and does not move the thirty-day boundary.
	var before time.Time
	s.DB.QueryRow("SELECT login_until FROM kitchen_devices WHERE id=$1", did).Scan(&before)
	rr := call(t, New(s, a.Config), "POST", "/api/auth/refresh", map[string]string{}, device, a.Config.Origin)
	mustStatus(t, rr, 200)
	var after time.Time
	s.DB.QueryRow("SELECT login_until FROM kitchen_devices WHERE id=$1", did).Scan(&after)
	if !before.Equal(after) {
		t.Fatal("refresh extended remembered access")
	}
	rr = call(t, a, "POST", "/api/auth/login", map[string]string{"username": second.Username, "password": p2}, device, a.Config.Origin)
	mustStatus(t, rr, 200)
	current := sessionCookie(t, rr)
	mustStatus(t, alertCall(a, previousNative.Token, "GET", "/api/kitchen-device/alerts", nil), 401)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, old, ""), 401)
	mustStatus(t, call(t, a, "GET", fmt.Sprintf("/api/staff/stores/%d/orders", secondStore.ID), nil, current, ""), 200)
	mustStatus(t, call(t, a, "GET", "/api/staff/stores/1/orders", nil, current, ""), 403)
	mustStatus(t, call(t, a, "PUT", fmt.Sprintf("/api/owner/stores/%d/kitchen-access", secondStore.ID), map[string]any{"username": second.Username, "active": true, "rotate_password": true}, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "GET", "/api/auth/me", nil, current, ""), 401)
	mustStatus(t, call(t, a, "POST", "/api/auth/refresh", map[string]string{}, device, a.Config.Origin), 401)
	if _, e := s.DB.Exec("UPDATE kitchen_devices SET account_version=(SELECT version FROM staff_accounts WHERE id=$2),login_until=now()-interval '1 second' WHERE id=$1", did, second.ID); e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "POST", "/api/auth/refresh", map[string]string{}, device, a.Config.Origin), 401)
}
func TestSharedKitchenPendingExpiryAndConstraints(t *testing.T) {
	s, a, owner := accessFixture(t)
	u, password := sharedFixture(t, a, owner, 1, "point-kitchen")
	rr := call(t, a, "POST", "/api/auth/login", map[string]string{"username": u.Username, "password": password}, nil, a.Config.Origin)
	mustStatus(t, rr, 202)
	device := deviceCookieFrom(t, rr)
	if _, e := s.DB.Exec("UPDATE kitchen_devices SET pending_until=now()-interval '1 second'"); e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "POST", "/api/auth/device-session", map[string]string{}, device, a.Config.Origin), 410)
	var id int64
	s.DB.QueryRow("SELECT id FROM kitchen_devices LIMIT 1").Scan(&id)
	mustStatus(t, call(t, a, "POST", fmt.Sprintf("/api/owner/kitchen-devices/%d", id), map[string]string{"action": "approve"}, owner, a.Config.Origin), 409)
	if _, e := s.DB.Exec("INSERT INTO staff_accounts(username,display_name,password_hash,account_type,kitchen_store_id) VALUES('duplicate','Duplicate','x','kitchen',1)"); e == nil {
		t.Fatal("duplicate active store account accepted")
	}
	if _, e := s.DB.Exec("UPDATE staff_accounts SET owner=true WHERE id=$1", u.ID); e == nil {
		t.Fatal("shared owner accepted")
	}
}
