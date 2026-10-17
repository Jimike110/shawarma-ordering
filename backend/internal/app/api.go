package app

import (
	"net/http"

	"context"

	"time"

	"log"
)

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

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if e := a.Store.DB.PingContext(r.Context()); e != nil {
		reply(w, 503, map[string]string{"status": "unavailable"})
		return
	}
	reply(w, 200, map[string]string{"status": "ok"})
}
