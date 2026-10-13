package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTrustedProxyClientIP(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/health", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("X-Real-IP", "198.51.100.2")
	a := &API{}
	if a.clientIP(req) != "192.0.2.1" {
		t.Fatal("trusted a spoofed proxy header")
	}
	a.Config.TrustProxy = true
	if a.clientIP(req) != "198.51.100.2" {
		t.Fatal("proxy client IP lost")
	}
	req.Header.Set("X-Real-IP", "invalid")
	if a.clientIP(req) != "192.0.2.1" {
		t.Fatal("invalid proxy IP accepted")
	}
}
func TestSecureSessionCookie(t *testing.T) {
	a := &API{Config: Config{Secure: true}}
	rr := httptest.NewRecorder()
	a.cookie(rr, strings.Repeat("a", 43), 43200)
	c := rr.Result().Cookies()[0]
	if !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
		t.Fatal("HTTPS session cookie is not secure")
	}
}
func TestConfigRejectsUnsafeValues(t *testing.T) {
	t.Setenv("PUBLIC_ORIGIN", "http://localhost:5173")
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 64))
	t.Setenv("KITCHEN_PASSWORD", "test-only-password")
	t.Setenv("KITCHEN_PASSWORD_HASH", "")
	t.Setenv("COOKIE_SECURE", "false")
	for _, origin := range []string{"", "https://example.com/", "https://example.com?x=y", "javascript:alert(1)"} {
		t.Setenv("PUBLIC_ORIGIN", origin)
		if _, e := LoadConfig(); e == nil {
			t.Fatalf("accepted origin %s", origin)
		}
	}
	t.Setenv("PUBLIC_ORIGIN", "http://localhost:5173")
	t.Setenv("SESSION_SECRET", "weak")
	if _, e := LoadConfig(); e == nil {
		t.Fatal("weak secret accepted")
	}
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 64))
	t.Setenv("KITCHEN_PASSWORD", "weak")
	if _, e := LoadConfig(); e != nil {
		t.Fatal("legacy environment password must not configure database-backed accounts")
	}
	t.Setenv("KITCHEN_PASSWORD", "test-only-password")
	t.Setenv("PUBLIC_ORIGIN", "https://example.com")
	if _, e := LoadConfig(); e == nil {
		t.Fatal("insecure HTTPS cookie accepted")
	}
}
