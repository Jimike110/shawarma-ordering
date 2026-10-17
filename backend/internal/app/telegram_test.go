package app

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

func signedTelegram(id int64, when time.Time, token string) string {
	v := url.Values{"auth_date": {fmt.Sprint(when.Unix())}, "user": {fmt.Sprintf(`{"id":%d,"first_name":"DO NOT STORE"}`, id)}, "query_id": {"synthetic"}}
	keys := []string{}
	for k := range v {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := []string{}
	for _, k := range keys {
		parts = append(parts, k+"="+v.Get(k))
	}
	k := hmac.New(sha256.New, []byte("WebAppData"))
	k.Write([]byte(token))
	mac := hmac.New(sha256.New, k.Sum(nil))
	mac.Write([]byte(strings.Join(parts, "\n")))
	v.Set("hash", hex.EncodeToString(mac.Sum(nil)))
	return v.Encode()
}
func TestTelegramLaunchValidation(t *testing.T) {
	now := time.Now()
	token := "123:synthetic"
	for _, tc := range []struct {
		name, raw string
		valid     bool
	}{
		{"valid", signedTelegram(123, now, token), true},
		{"stale", signedTelegram(123, now.Add(-61*time.Minute), token), false},
		{"future", signedTelegram(123, now.Add(2*time.Minute), token), false},
		{"wrong bot", signedTelegram(123, now, "different"), false},
		{"invalid user", signedTelegram(-1, now, token), false},
		{"duplicates", signedTelegram(123, now, token) + "&auth_date=1", false},
		{"forged", strings.Replace(signedTelegram(123, now, token), "synthetic", "forged", 1), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id, _, e := validateTelegramInit(tc.raw, token, now)
			if (e == nil) != tc.valid || (tc.valid && id != 123) {
				t.Fatalf("validation result id=%d err=%v", id, e)
			}
		})
	}
	c := checkout()
	raw, _ := json.Marshal(c)
	if strings.Contains(string(raw), "telegram") {
		t.Fatal("legacy fingerprint changed")
	}
}

type telegramTransport func(*http.Request) (*http.Response, error)

func (f telegramTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func telegramTestAPI(t *testing.T) (*API, *Store, *[]map[string]any) {
	t.Helper()
	s := testStore(t)
	o := testOperator()
	o.Telegram = true
	p, c := privacyTexts(o)
	var version int64
	if e := s.DB.QueryRow("INSERT INTO privacy_versions(template_version,operator,policy,consent,telegram_consent) VALUES($1,$2,$3,$4,$5) RETURNING id", privacyTemplate, mustJSON(o), p, c, telegramConsentText(o)).Scan(&version); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec("UPDATE privacy_settings SET current_version=$1", version); e != nil {
		t.Fatal(e)
	}
	sent := []map[string]any{}
	var mu sync.Mutex
	cfg := Config{Origin: "http://localhost:5173", Secret: strings.Repeat("test-secret", 4), Telegram: TelegramConfig{Enabled: true, BotToken: "123:synthetic", BotUsername: "SyntheticTestBot", WebhookSecret: strings.Repeat("w", 32), DispatchSecret: strings.Repeat("d", 32)}}
	cfg.Telegram.Client = &http.Client{Transport: telegramTransport(func(r *http.Request) (*http.Response, error) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		sent = append(sent, payload)
		mu.Unlock()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"ok":true}`)), Header: make(http.Header)}, nil
	})}
	return New(s, cfg), s, &sent
}
func telegramCall(t *testing.T, a *API, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, bytes.NewReader(mustJSON(body)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", a.Config.Origin)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}
func telegramTestSession(t *testing.T, a *API, id int64) string {
	t.Helper()
	w := telegramCall(t, a, "POST", "/api/telegram/session", map[string]string{"init_data": signedTelegram(id, time.Now(), a.Config.Telegram.BotToken)}, "")
	mustStatus(t, w, 201)
	var out struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return out.Token
}
func telegramTestCheckout(t *testing.T, a *API, s *Store, token string) (Checkout, Order) {
	t.Helper()
	c := checkout()
	c.RequestKey = hex.EncodeToString([]byte(randomToken()))[:48]
	var v int64
	_ = s.DB.QueryRow("SELECT current_version FROM privacy_settings WHERE id=1").Scan(&v)
	c.Privacy.NoticeVersion = v
	c.Privacy.ConsentVersion = v
	w := telegramCall(t, a, "POST", "/api/telegram/checkout-intents", map[string]any{"store_id": 1, "request_key": c.RequestKey, "consent_version": v, "accepted": true}, token)
	mustStatus(t, w, 201)
	var choice TelegramCheckout
	_ = json.Unmarshal(w.Body.Bytes(), &choice)
	c.Telegram = &choice
	w = telegramCall(t, a, "POST", "/api/orders", c, token)
	mustStatus(t, w, 201)
	var order Order
	_ = json.Unmarshal(w.Body.Bytes(), &order)
	if len(order.TelegramHandle) != 43 {
		t.Fatal("missing handle")
	}
	return c, order
}
func TestTelegramCheckoutIsolationAndRetry(t *testing.T) {
	a, s, sent := telegramTestAPI(t)
	token := telegramTestSession(t, a, 111)
	c, o := telegramTestCheckout(t, a, s, token)
	if len(*sent) != 1 {
		t.Fatal("accepted notification missing")
	}
	raw := string(mustJSON(*sent))
	if strings.Contains(raw, c.Name) || strings.Contains(raw, o.Token) || strings.Contains(raw, "DO NOT STORE") {
		t.Fatal("message contains protected content")
	}
	mustStatus(t, telegramCall(t, a, "GET", "/api/telegram/orders/"+o.TelegramHandle, nil, token), 200)
	other := telegramTestSession(t, a, 222)
	mustStatus(t, telegramCall(t, a, "GET", "/api/telegram/orders/"+o.TelegramHandle, nil, other), 404)
	mustStatus(t, telegramCall(t, a, "GET", "/api/staff/stores/1/orders", nil, token), 401)
	mustStatus(t, telegramCall(t, a, "GET", "/api/kitchen-device/alerts", nil, token), 401)
	mustStatus(t, telegramCall(t, a, "GET", "/api/owner/telegram/health", nil, token), 401)
	// An expired session and intent plus unpublished documents cannot invalidate an accepted retry.
	_, _ = s.DB.Exec("UPDATE telegram_sessions SET expires_at=now()-interval '1 hour'")
	_, _ = s.DB.Exec("DELETE FROM telegram_intents")
	_, _ = s.DB.Exec("UPDATE privacy_settings SET current_version=NULL")
	w := telegramCall(t, a, "POST", "/api/orders", c, "")
	mustStatus(t, w, 201)
	var retry Order
	_ = json.Unmarshal(w.Body.Bytes(), &retry)
	if retry.ID != o.ID || retry.Token != o.Token {
		t.Fatal("retry changed order")
	}
	modified := c
	modified.Telegram = &TelegramCheckout{IntentID: strings.Repeat("a", 43)}
	mustStatus(t, telegramCall(t, a, "POST", "/api/orders", modified, ""), 409)
	var count int
	_ = s.DB.QueryRow("SELECT count(*) FROM orders").Scan(&count)
	if count != 1 {
		t.Fatal("duplicate order")
	}
}
func TestTelegramGuardsAndNoOptIn(t *testing.T) {
	a, s, sent := telegramTestAPI(t)
	c := checkout()
	var v int64
	_ = s.DB.QueryRow("SELECT current_version FROM privacy_settings").Scan(&v)
	c.Privacy.NoticeVersion = v
	c.Privacy.ConsentVersion = v
	c.Telegram = &TelegramCheckout{}
	mustStatus(t, telegramCall(t, a, "POST", "/api/orders", c, ""), 201)
	if len(*sent) != 0 {
		t.Fatal("sent without opt-in")
	}
	c.RequestKey = strings.Repeat("2", 48)
	c.Telegram = &TelegramCheckout{IntentID: randomToken()}
	mustStatus(t, telegramCall(t, a, "POST", "/api/orders", c, ""), 401)
	token := telegramTestSession(t, a, 123)
	for _, body := range []map[string]any{
		{"store_id": 1, "request_key": c.RequestKey, "consent_version": v, "accepted": false},
		{"store_id": 99999, "request_key": c.RequestKey, "consent_version": v, "accepted": true},
		{"store_id": 1, "request_key": c.RequestKey, "consent_version": 1, "accepted": true},
	} {
		w := telegramCall(t, a, "POST", "/api/telegram/checkout-intents", body, token)
		if w.Code != 400 && w.Code != 409 {
			t.Fatalf("unguarded intent: %d", w.Code)
		}
	}
	a.Config.Telegram.Enabled = false
	s.Telegram = a.Config.Telegram
	c.RequestKey = strings.Repeat("3", 48)
	c.Telegram = &TelegramCheckout{}
	mustStatus(t, telegramCall(t, a, "POST", "/api/orders", c, ""), 409)
}
func TestTelegramOutboxFailureAndStaleEvents(t *testing.T) {
	a, s, _ := telegramTestAPI(t)
	token := telegramTestSession(t, a, 123)
	_, o := telegramTestCheckout(t, a, s, token)
	ctx := shopContext(context.Background(), 1)
	if _, e := s.UpdateOrder(ctx, o.ID, OrderUpdate{Status: "preparing"}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.UpdateOrder(ctx, o.ID, OrderUpdate{Status: "ready"}); e != nil {
		t.Fatal(e)
	}
	a.Config.Telegram.Client = &http.Client{Transport: telegramTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader(`{"ok":false,"error_code":429,"parameters":{"retry_after":600}}`)), Header: make(http.Header)}, nil
	})}
	_, _ = s.DB.Exec("UPDATE telegram_health SET last_dispatch=NULL")
	if _, e := a.DispatchTelegram(ctx, 1); e != nil {
		t.Fatal(e)
	}
	var delayed bool
	_ = s.DB.QueryRow("SELECT state='pending' AND next_at>now()+interval '9 minutes' FROM telegram_outbox WHERE order_id=$1 AND event='ready'", o.ID).Scan(&delayed)
	if !delayed {
		t.Fatal("retry_after ignored")
	}
	if _, e := s.UpdateOrder(ctx, o.ID, OrderUpdate{Status: "completed"}); e != nil {
		t.Fatal(e)
	}
	_, _ = s.DB.Exec("UPDATE telegram_outbox SET next_at=now() WHERE order_id=$1", o.ID)
	_, _ = s.DB.Exec("UPDATE telegram_health SET last_dispatch=NULL")
	if _, e := a.DispatchTelegram(ctx, 1); e != nil {
		t.Fatal(e)
	}
	var state string
	_ = s.DB.QueryRow("SELECT state FROM telegram_outbox WHERE order_id=$1 AND event='ready'", o.ID).Scan(&state)
	if state != "skipped" {
		t.Fatal("obsolete ready notification not suppressed")
	}
}
func TestTelegramUnsubscribeRetentionAndReplay(t *testing.T) {
	a, s, _ := telegramTestAPI(t)
	token := telegramTestSession(t, a, 123)
	_, o := telegramTestCheckout(t, a, s, token)
	var savedRecipient int64
	var handle string
	_ = s.DB.QueryRow("SELECT recipient,handle FROM telegram_subscriptions WHERE order_id=$1", o.ID).Scan(&savedRecipient, &handle)
	mustStatus(t, telegramCall(t, a, "DELETE", "/api/telegram/orders/"+handle, nil, token), 200)
	// Simulate an old snapshot restoring the erased mapping; the independent journal removes it.
	_, e := s.DB.Exec("INSERT INTO telegram_subscriptions(order_id,recipient,handle,version_id) VALUES($1,$2,$3,2)", o.ID, savedRecipient, handle)
	if e != nil {
		t.Fatal(e)
	}
	_, _ = s.DB.Exec("DELETE FROM privacy_destructions WHERE target_kind='telegram_order'")
	if _, e = s.ReplayPrivacyJournal(context.Background()); e != nil {
		t.Fatal(e)
	}
	var n int
	_ = s.DB.QueryRow("SELECT count(*) FROM telegram_subscriptions").Scan(&n)
	if n != 0 {
		t.Fatal("journal resurrected mapping")
	}
	token = telegramTestSession(t, a, 123)
	_, o = telegramTestCheckout(t, a, s, token)
	_, _ = s.DB.Exec("UPDATE orders SET status='completed',closed_at=now()-interval '7 days' WHERE id=$1", o.ID)
	mustStatus(t, telegramCall(t, a, "GET", "/api/telegram/orders/"+o.TelegramHandle, nil, token), 404)
	_, _ = s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true")
	if _, e = s.PrivacyMaintenance(context.Background(), 100); e != nil {
		t.Fatal(e)
	}
	_ = s.DB.QueryRow("SELECT count(*) FROM telegram_subscriptions").Scan(&n)
	if n != 0 {
		t.Fatal("expired mapping retained")
	}
	if _, e = s.Track(context.Background(), o.Token); e != nil {
		t.Fatal("browser receipt lost")
	}
}
func TestTelegramWebhookStopAndSecret(t *testing.T) {
	a, s, _ := telegramTestAPI(t)
	token := telegramTestSession(t, a, 123)
	_, o := telegramTestCheckout(t, a, s, token)
	body := map[string]any{"update_id": 1, "message": map[string]any{"chat": map[string]any{"id": 123, "type": "private"}, "text": "/stop"}}
	mustStatus(t, telegramCall(t, a, "POST", "/api/telegram/webhook", body, ""), 403)
	for i := 0; i < 2; i++ {
		if i == 0 {
			a.Config.Telegram.Enabled = false
		} // withdrawal works while sending is disabled
		r := httptest.NewRequest("POST", "/api/telegram/webhook", bytes.NewReader(mustJSON(body)))
		r.Header.Set("X-Telegram-Bot-Api-Secret-Token", a.Config.Telegram.WebhookSecret)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		mustStatus(t, w, 200)
	}
	var n int
	_ = s.DB.QueryRow("SELECT count(*) FROM telegram_subscriptions WHERE order_id=$1", o.ID).Scan(&n)
	if n != 0 {
		t.Fatal("stop failed")
	}
	_ = s.DB.QueryRow("SELECT count(*) FROM telegram_updates").Scan(&n)
	if n != 1 {
		t.Fatal("updates not deduplicated")
	}
}

func TestTelegramDeliveryFailureConcurrentRecovery(t *testing.T) {
	a, s, _ := telegramTestAPI(t)
	a.Config.Telegram.Client = &http.Client{Transport: telegramTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("synthetic lost response") })}
	token := telegramTestSession(t, a, 123)
	_, order := telegramTestCheckout(t, a, s, token) // committed HTTP 201 despite transport failure
	var n int
	if e := s.DB.QueryRow("SELECT count(*) FROM orders WHERE id=$1", order.ID).Scan(&n); e != nil || n != 1 {
		t.Fatal("transport failure lost accepted order")
	}
	_, _ = s.DB.Exec("UPDATE telegram_outbox SET next_at=now(),lease='orphan',lease_until=now()-interval '1 second' WHERE order_id=$1", order.ID)
	_, _ = s.DB.Exec("UPDATE telegram_health SET last_dispatch=NULL")
	var mu sync.Mutex
	calls := 0
	a.Config.Telegram.Client = &http.Client{Transport: telegramTransport(func(*http.Request) (*http.Response, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"ok":true}`)), Header: make(http.Header)}, nil
	})}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := a.DispatchTelegram(context.Background(), 1); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	if calls != 1 {
		t.Fatalf("concurrent recovery sent %d times", calls)
	}
}

func TestTelegramUnacceptedIntentExpiryAndStoreBinding(t *testing.T) {
	a, s, _ := telegramTestAPI(t)
	token := telegramTestSession(t, a, 123)
	c := checkout()
	c.StoreID = 1
	c.Privacy.NoticeVersion = 2
	c.Privacy.ConsentVersion = 2
	w := telegramCall(t, a, "POST", "/api/telegram/checkout-intents", map[string]any{"store_id": 1, "request_key": c.RequestKey, "consent_version": 2, "accepted": true}, token)
	mustStatus(t, w, 201)
	var intent TelegramCheckout
	_ = json.Unmarshal(w.Body.Bytes(), &intent)
	c.Telegram = &intent
	changed := c
	changed.RequestKey = strings.Repeat("b", 48)
	mustStatus(t, telegramCall(t, a, "POST", "/api/orders", changed, token), 409)
	_, _ = s.DB.Exec("UPDATE telegram_intents SET expires_at=now()-interval '1 second'")
	mustStatus(t, telegramCall(t, a, "POST", "/api/orders", c, token), 409)
	var n int
	_ = s.DB.QueryRow("SELECT count(*) FROM orders").Scan(&n)
	if n != 0 {
		t.Fatal("invalid intent created an order")
	}
}
