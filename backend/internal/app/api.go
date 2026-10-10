package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
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
	Origin       string
	Secret       string
	PasswordHash []byte
	// Stable identity for an environment-supplied shared password, independent of bcrypt's salt.
	PasswordCredential string
	Secure             bool
	TrustProxy         bool
	StaffUsers         map[string][]byte
}

func LoadConfig() (Config, error) {
	c := Config{Origin: os.Getenv("PUBLIC_ORIGIN"), Secret: os.Getenv("SESSION_SECRET"), Secure: os.Getenv("COOKIE_SECURE") == "true", TrustProxy: os.Getenv("TRUST_PROXY") == "true"}
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
	if users := os.Getenv("STAFF_USERS"); users != "" {
		var hashes map[string]string
		if e = json.Unmarshal([]byte(users), &hashes); e != nil || len(hashes) == 0 {
			return c, errors.New("STAFF_USERS must be a nonempty JSON object of usernames and bcrypt hashes")
		}
		c.StaffUsers = map[string][]byte{}
		for name, hash := range hashes {
			if name == "" || len(name) > 60 || strings.ContainsAny(name, " \t\r\n") {
				return c, errors.New("invalid staff username")
			}
			if _, e = bcrypt.Cost([]byte(hash)); e != nil {
				return c, errors.New("invalid staff bcrypt hash")
			}
			c.StaffUsers[name] = []byte(hash)
		}
	} else if hash := os.Getenv("KITCHEN_PASSWORD_HASH"); hash != "" {
		c.PasswordHash = []byte(hash)
		if _, e = bcrypt.Cost(c.PasswordHash); e != nil {
			return c, e
		}
	} else {
		password := os.Getenv("KITCHEN_PASSWORD")
		if len(password) < 12 || len(password) > 72 {
			return c, errors.New("KITCHEN_PASSWORD must have 12 to 72 bytes, or provide KITCHEN_PASSWORD_HASH")
		}
		c.PasswordHash, e = bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if e != nil {
			return c, e
		}
		m := hmac.New(sha256.New, []byte(c.Secret))
		_, _ = m.Write([]byte("shared-kitchen-session-v1\x00"))
		_, _ = m.Write([]byte(password))
		c.PasswordCredential = base64.RawURLEncoding.EncodeToString(m.Sum(nil))
	}
	return c, nil
}

func (c Config) credentialHash(hash []byte) string {
	if len(c.StaffUsers) == 0 && c.PasswordCredential != "" {
		return c.PasswordCredential
	}
	// Explicit bcrypt hashes remain stable and changes still revoke existing sessions.
	return Hash(string(hash))
}

type API struct {
	Store   *Store
	Config  Config
	handler http.Handler
}

func New(store *Store, c Config) *API {
	a := &API{Store: store, Config: c}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/menu", a.menu)
	mux.HandleFunc("POST /api/orders", a.createOrder)
	mux.HandleFunc("GET /api/orders/{token}", a.track)
	mux.HandleFunc("POST /api/kitchen/login", a.login)
	mux.HandleFunc("POST /api/kitchen/logout", a.staff(a.logout))
	mux.HandleFunc("GET /api/kitchen/session", a.staff(func(w http.ResponseWriter, r *http.Request) { reply(w, 200, map[string]bool{"authenticated": true}) }))
	mux.HandleFunc("GET /api/kitchen/orders", a.staff(a.orders))
	mux.HandleFunc("PATCH /api/kitchen/orders/{id}", a.staff(a.updateOrder))
	mux.HandleFunc("POST /api/kitchen/products", a.staff(a.saveProduct))
	mux.HandleFunc("PUT /api/kitchen/products/{id}", a.staff(a.saveProduct))
	mux.HandleFunc("PUT /api/kitchen/settings", a.staff(a.saveSettings))
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
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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
		log.Printf("API error: %v", e)
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
	open, message := s.Intake(time.Now())
	reply(w, 200, map[string]any{"products": p, "settings": s, "accepting_orders": open, "intake_message": message, "estimated_minutes": minutes})
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
	ok, e := a.Store.Allow(r.Context(), kind+":"+Hash(a.clientIP(r)), n)
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
	o, e := a.Store.CreateOrder(r.Context(), c, a.orderToken(c.RequestKey))
	if e != nil {
		fail(w, e)
		return
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
func (a *API) cookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: "kitchen_session", Value: token, Path: "/api/kitchen", HttpOnly: true, Secure: a.Config.Secure, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Password string `json:"password"`
		Username string `json:"username"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !a.limit(w, r, "login", 10) {
		return
	}
	name, hash := "kitchen", a.Config.PasswordHash
	if len(a.Config.StaffUsers) > 0 {
		name = input.Username
		hash = a.Config.StaffUsers[name]
	}
	// Unknown usernames still perform bcrypt work to avoid disclosing staff names.
	if len(hash) == 0 {
		hash = []byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy")
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(input.Password)) != nil || (len(a.Config.StaffUsers) > 0 && a.Config.StaffUsers[name] == nil) {
		reply(w, 401, map[string]string{"error": "Неверный логин или пароль."})
		return
	}
	token := randomToken()
	if e := a.Store.CreateNamedSession(r.Context(), token, name, a.Config.credentialHash(hash)); e != nil {
		fail(w, e)
		return
	}
	a.cookie(w, token, 43200)
	reply(w, 200, map[string]bool{"authenticated": true})
}
func (a *API) staff(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Header.Get("Origin") != a.Config.Origin {
			reply(w, 403, map[string]string{"error": "Недопустимый источник запроса."})
			return
		}
		c, e := r.Cookie("kitchen_session")
		if e != nil || len(c.Value) != 43 {
			reply(w, 401, map[string]string{"error": "Войдите в панель кухни."})
			return
		}
		name, credential, ok, e := a.Store.SessionIdentity(r.Context(), c.Value)
		if e != nil {
			fail(w, e)
			return
		}
		hash := a.Config.PasswordHash
		if len(a.Config.StaffUsers) > 0 {
			hash = a.Config.StaffUsers[name]
		}
		if !ok || len(hash) == 0 || (credential != "" && credential != a.Config.credentialHash(hash)) {
			reply(w, 401, map[string]string{"error": "Сессия истекла. Войдите снова."})
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), staffContextKey{}, name)))
	}
}
func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("kitchen_session")
	if e := a.Store.Logout(r.Context(), c.Value); e != nil {
		fail(w, e)
		return
	}
	a.cookie(w, "", -1)
	reply(w, 200, map[string]bool{"authenticated": false})
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
