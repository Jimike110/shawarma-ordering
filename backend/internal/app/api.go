package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Origin     string
	Secret     string
	Secure     bool
	TrustProxy bool
	Telegram   TelegramConfig
}

func LoadConfig() (Config, error) {
	c := Config{Origin: os.Getenv("PUBLIC_ORIGIN"), Secret: os.Getenv("SESSION_SECRET"), Secure: os.Getenv("COOKIE_SECURE") == "true", TrustProxy: os.Getenv("TRUST_PROXY") == "true"}
	c.Telegram = loadTelegramConfig()
	u, e := url.Parse(c.Origin)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return c, errors.New("PUBLIC_ORIGIN must be an origin without path, for example http://localhost:5173")
	}
	if u.Scheme == "https" && !c.Secure {
		return c, errors.New("COOKIE_SECURE must be true for HTTPS")
	}
	if len(c.Secret) < 32 {
		return c, errors.New("SESSION_SECRET must have at least 32 characters")
	}

	return c, nil
}

type API struct {
	Store   *Store
	Config  Config
	handler http.Handler
}

func New(store *Store, c Config) *API {
	if store.PrivacyKey == "" {
		store.PrivacyKey = c.Secret
	}
	a := &API{Store: store, Config: c}
	store.Telegram = c.Telegram
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/telegram/config", a.telegramConfig)
	mux.HandleFunc("POST /api/telegram/session", a.telegramSession)
	mux.HandleFunc("POST /api/telegram/checkout-intents", a.telegramIntent)
	mux.HandleFunc("GET /api/telegram/orders/{handle}", a.telegramOrder)
	mux.HandleFunc("DELETE /api/telegram/orders/{handle}", a.telegramOrder)
	mux.HandleFunc("POST /api/telegram/webhook", a.telegramWebhook)
	mux.HandleFunc("POST /api/internal/telegram-dispatch", a.telegramDispatch)
	mux.HandleFunc("GET /api/owner/telegram/health", a.ownerOnly(a.telegramHealth, false))
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/privacy", a.privacyPublic)
	mux.HandleFunc("GET /api/privacy/versions/{id}", a.privacyPublic)
	mux.HandleFunc("GET /api/owner/privacy", a.ownerOnly(a.privacyOwner, false))
	mux.HandleFunc("PUT /api/owner/privacy/draft", a.ownerOnly(a.privacyDraft, true))
	mux.HandleFunc("POST /api/owner/privacy/publish", a.ownerOnly(a.privacyPublish, true))
	mux.HandleFunc("GET /api/owner/privacy/retention", a.ownerOnly(a.privacyRetention, false))
	mux.HandleFunc("POST /api/owner/privacy/retention", a.ownerOnly(a.privacyRetention, true))
	mux.HandleFunc("GET /api/owner/privacy/requests", a.ownerOnly(a.privacyRequests, true))
	mux.HandleFunc("GET /api/owner/privacy/destructions", a.ownerOnly(a.privacyDestructions, true))
	mux.HandleFunc("POST /api/owner/privacy/requests", a.ownerOnly(a.privacyRequests, true))
	mux.HandleFunc("POST /api/owner/privacy/requests/{id}", a.ownerOnly(a.privacyRequestAction, true))
	mux.HandleFunc("GET /api/menu", a.menu)
	mux.HandleFunc("POST /api/orders", a.createOrder)
	mux.HandleFunc("GET /api/orders/{token}", a.track)
	mux.HandleFunc("GET /api/stores", a.publicShops)
	mux.HandleFunc("GET /api/stores/{slug}/menu", a.storeMenu)
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("POST /api/auth/refresh", a.kitchenRefresh)
	mux.HandleFunc("POST /api/auth/device-session", a.kitchenRefresh)
	mux.HandleFunc("GET /api/auth/me", a.authenticated(a.me, true))
	mux.HandleFunc("POST /api/auth/logout", a.authenticated(a.logout, true))
	mux.HandleFunc("POST /api/auth/change-password", a.authenticated(a.changePassword, true))
	mux.HandleFunc("POST /api/auth/reauthenticate", a.authenticated(a.reauthenticate, false))
	mux.HandleFunc("GET /api/staff/stores", a.authenticated(a.staffShops, false))
	mux.HandleFunc("GET /api/staff/stores/{storeId}/menu", a.scoped(a.menu, false))
	mux.HandleFunc("GET /api/staff/stores/{storeId}/orders", a.scoped(a.orders, false))
	mux.HandleFunc("GET /api/staff/stores/{storeId}/history", a.scoped(a.orderHistory, true))
	mux.HandleFunc("PATCH /api/staff/stores/{storeId}/orders/{id}", a.scoped(a.updateOrder, false))
	mux.HandleFunc("PATCH /api/staff/stores/{storeId}/operations", a.scoped(a.operational, false))
	mux.HandleFunc("PATCH /api/staff/stores/{storeId}/products/{id}/availability", a.scoped(a.availability, false))
	mux.HandleFunc("GET /api/staff/stores/{storeId}/toppings", a.scoped(a.listToppings, false))
	mux.HandleFunc("POST /api/staff/stores/{storeId}/toppings", a.scoped(a.saveTopping, true))
	mux.HandleFunc("PUT /api/staff/stores/{storeId}/toppings/{id}", a.scoped(a.saveTopping, true))
	mux.HandleFunc("PATCH /api/staff/stores/{storeId}/toppings/{id}/availability", a.scoped(a.toppingAvailability, false))
	mux.HandleFunc("POST /api/staff/stores/{storeId}/products", a.scoped(a.saveProduct, true))
	mux.HandleFunc("PUT /api/staff/stores/{storeId}/products/{id}", a.scoped(a.saveProduct, true))
	mux.HandleFunc("DELETE /api/staff/stores/{storeId}/products/{id}", a.scoped(a.deleteProduct, true))
	mux.HandleFunc("PUT /api/staff/stores/{storeId}/settings", a.scoped(a.saveSettings, true))
	mux.HandleFunc("GET /api/staff/stores/{storeId}/analytics", a.scoped(a.analytics, true))
	mux.HandleFunc("GET /api/staff/stores/{storeId}/activity", a.scoped(a.activity, true))
	mux.HandleFunc("GET /api/owner/stores", a.ownerOnly(a.staffShops, false))
	mux.HandleFunc("POST /api/owner/stores", a.ownerOnly(a.createShop, true))
	mux.HandleFunc("PATCH /api/owner/stores/{id}", a.ownerOnly(a.storeLifecycle, true))
	mux.HandleFunc("GET /api/owner/users", a.ownerOnly(a.listAccounts, false))
	mux.HandleFunc("GET /api/owner/kitchen-access", a.ownerOnly(a.kitchenAccess, false))
	mux.HandleFunc("PUT /api/owner/stores/{id}/kitchen-access", a.ownerOnly(a.saveKitchenAccess, true))
	mux.HandleFunc("POST /api/owner/kitchen-devices/{id}", a.ownerOnly(a.kitchenDeviceAction, true))
	mux.HandleFunc("POST /api/kitchen-device/native-token", a.authenticated(a.nativeKitchenToken, false))
	mux.HandleFunc("GET /api/kitchen-device/alerts", a.nativeKitchen(a.kitchenAlertState))
	mux.HandleFunc("POST /api/kitchen-device/heartbeat", a.nativeKitchen(a.kitchenHeartbeat))
	mux.HandleFunc("POST /api/staff/device-heartbeat", a.authenticated(a.kitchenHeartbeat, false))
	mux.HandleFunc("POST /api/owner/users", a.ownerOnly(a.saveAccount, true))
	mux.HandleFunc("PUT /api/owner/users/{id}", a.ownerOnly(a.saveAccount, true))
	mux.HandleFunc("POST /api/owner/users/{id}/reset-password", a.ownerOnly(a.resetPassword, true))
	mux.HandleFunc("POST /api/owner/menu-copy", a.ownerOnly(a.copyMenu, true))
	mux.HandleFunc("GET /api/owner/orders", a.ownerOnly(func(w http.ResponseWriter, r *http.Request) {
		a.orderHistory(w, r.WithContext(shopContext(r.Context(), 0)))
	}, false))
	mux.HandleFunc("GET /api/owner/analytics", a.ownerOnly(a.analytics, false))
	mux.HandleFunc("GET /api/owner/activity", a.ownerOnly(a.activity, false))
	// Legacy routes are strictly bound to the original store and the same policies.
	mux.HandleFunc("POST /api/kitchen/login", a.login)
	mux.HandleFunc("POST /api/kitchen/logout", a.authenticated(a.logout, true))
	mux.HandleFunc("GET /api/kitchen/session", a.authenticated(a.me, true))
	mux.HandleFunc("GET /api/kitchen/orders", a.scoped(a.orders, false))
	mux.HandleFunc("PATCH /api/kitchen/orders/{id}", a.scoped(a.updateOrder, false))
	mux.HandleFunc("POST /api/kitchen/products", a.scoped(a.saveProduct, true))
	mux.HandleFunc("PUT /api/kitchen/products/{id}", a.scoped(a.saveProduct, true))
	mux.HandleFunc("DELETE /api/kitchen/products/{id}", a.scoped(a.deleteProduct, true))
	mux.HandleFunc("PUT /api/kitchen/settings", a.scoped(a.saveSettings, true))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 404, map[string]string{"error": "Маршрут не найден."})
	})
	a.handler = mux
	return a
}
func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	defer func() {
		if time.Since(start) > 2*time.Second {
			log.Printf("slow API request method=%s duration=%s", r.Method, time.Since(start).Round(time.Millisecond))
		}
	}()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != "GET" && r.Method != "HEAD" {
		origin := r.Header.Get("Origin")
		if origin != "" && origin != a.Config.Origin {
			reply(w, 403, map[string]string{"error": "Недопустимый источник запроса."})
			return
		}
	}
	requestTimeout := 10 * time.Second
	if r.URL.Path == "/api/internal/telegram-dispatch" {
		requestTimeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	a.handler.ServeHTTP(w, r.WithContext(ctx))
}
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, e error) {
	var p *Problem
	switch {
	case errors.As(e, &p):
		reply(w, p.Status, map[string]string{"error": p.Message})
	case errors.Is(e, ErrMissing):
		reply(w, 404, map[string]string{"error": "Заказ или товар не найден."})
	default:
		log.Printf("API request failed (%T)", e)
		reply(w, 500, map[string]string{"error": "Не удалось выполнить запрос. Попробуйте ещё раз."})
	}
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		reply(w, 415, map[string]string{"error": "Ожидается JSON."})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(value); e != nil {
		reply(w, 400, map[string]string{"error": "Некорректные данные запроса."})
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		reply(w, 400, map[string]string{"error": "Некорректные данные запроса."})
		return false
	}
	return true
}
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if e := a.Store.DB.PingContext(r.Context()); e != nil {
		reply(w, 503, map[string]string{"status": "unavailable"})
		return
	}
	reply(w, 200, map[string]string{"status": "ok"})
}
func (a *API) menu(w http.ResponseWriter, r *http.Request) {
	p, e := a.Store.Products(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	s, e := a.Store.Settings(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	minutes, e := a.Store.EstimatedMinutes(r.Context(), s.PrepMinutes)
	if e != nil {
		fail(w, e)
		return
	}
	shop, e := a.Store.Shop(r.Context(), shopID(r.Context()))
	if e != nil {
		fail(w, e)
		return
	}
	open, message := shop.Intake(time.Now())
	var ready bool
	if e = a.Store.DB.QueryRowContext(r.Context(), "SELECT current_version IS NOT NULL FROM privacy_settings WHERE id=1").Scan(&ready); e != nil {
		fail(w, e)
		return
	}
	if !ready {
		open = false
		message = "Оператор ещё не опубликовал документы. Приём новых заказов недоступен."
	}
	if actor(r.Context()).ID == 0 {
		shop.StopReason = ""
	}
	reply(w, 200, map[string]any{"products": p, "settings": s, "accepting_orders": open, "intake_message": message, "estimated_minutes": minutes, "store": shop, "privacy_ready": ready})
}
func (a *API) clientIP(r *http.Request) string {
	if a.Config.TrustProxy {
		if address := r.Header.Get("X-Real-IP"); net.ParseIP(address) != nil {
			return address
		}
	}
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e == nil {
		return host
	}
	return r.RemoteAddr
}
func (a *API) limit(w http.ResponseWriter, r *http.Request, kind string, n int) bool {
	ok, e := a.Store.Allow(r.Context(), kind+":"+a.Store.privacyDigest("rate-ip", a.clientIP(r)), n)
	if e != nil {
		fail(w, e)
		return false
	}
	if !ok {
		w.Header().Set("Retry-After", "600")
		reply(w, 429, map[string]string{"error": "Слишком много попыток. Попробуйте через 10 минут."})
		return false
	}
	return true
}
func (a *API) orderToken(key string) string {
	m := hmac.New(sha256.New, []byte(a.Config.Secret))
	m.Write([]byte("order:" + key))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
func randomToken() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func (a *API) createOrder(w http.ResponseWriter, r *http.Request) {
	var c Checkout
	if !decode(w, r, &c) {
		return
	}
	if e := c.Validate(); e != nil {
		fail(w, e)
		return
	}
	if !a.limit(w, r, "order", 30) {
		return
	}
	o, e := a.Store.CreateOrder(telegramContext(r.Context(), r), c, a.orderToken(c.RequestKey))
	if e != nil {
		fail(w, e)
		return
	}
	if c.Telegram != nil && c.Telegram.IntentID != "" {
		_, _ = a.DispatchTelegram(r.Context(), 1)
		_ = a.Store.DB.QueryRowContext(r.Context(), "SELECT handle FROM telegram_subscriptions WHERE order_id=$1", o.ID).Scan(&o.TelegramHandle)
	}
	reply(w, 201, o)
}
func (a *API) track(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if len(token) != 43 {
		fail(w, ErrMissing)
		return
	}
	o, e := a.Store.Track(r.Context(), token)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, o)
}
func (a *API) orders(w http.ResponseWriter, r *http.Request) {
	o, e := a.Store.Orders(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, o)
}
func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || id < 1 {
		fail(w, ErrMissing)
		return 0, false
	}
	return id, true
}
func (a *API) updateOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var u OrderUpdate
	if !decode(w, r, &u) {
		return
	}
	if e := ValidateUpdate(u); e != nil {
		fail(w, e)
		return
	}
	o, e := a.Store.UpdateOrder(r.Context(), id, u)
	if e != nil {
		fail(w, e)
		return
	}
	if u.Status == "ready" || u.Status == "cancelled" {
		_, _ = a.DispatchTelegram(r.Context(), 1)
	}
	reply(w, 200, o)
}
func (a *API) saveProduct(w http.ResponseWriter, r *http.Request) {
	var p Product
	if !decode(w, r, &p) {
		return
	}
	if r.Method == "PUT" {
		id, ok := parseID(w, r)
		if !ok {
			return
		}
		p.ID = id
	} else {
		p.ID = 0
	}
	if e := p.Validate(); e != nil {
		fail(w, e)
		return
	}
	p, e := a.Store.SaveProduct(r.Context(), p)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, p)
}
func (a *API) deleteProduct(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if e := a.Store.DeleteProduct(r.Context(), id); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}
func (a *API) saveSettings(w http.ResponseWriter, r *http.Request) {
	var s Settings
	if !decode(w, r, &s) {
		return
	}
	if e := s.Validate(); e != nil {
		fail(w, e)
		return
	}
	if e := a.Store.SaveSettings(r.Context(), s); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, s)
}
