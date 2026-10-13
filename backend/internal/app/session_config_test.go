package app

import (
	"context"
	"strings"
	"testing"
)

func TestDatabaseSessionAcrossInstances(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if e := s.BootstrapOwner(ctx, "owner", "Owner", "session-test-password"); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PUBLIC_ORIGIN", "https://shop.example")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 64))
	t.Setenv("KITCHEN_PASSWORD", "ignored-legacy-password")
	config, e := LoadConfig()
	if e != nil {
		t.Fatal(e)
	}
	a := New(s, config)
	rr := call(t, a, "POST", "/api/auth/login", map[string]string{"username": "owner", "password": "session-test-password"}, nil, config.Origin)
	mustStatus(t, rr, 200)
	cookie := sessionCookie(t, rr)
	if !cookie.Secure || cookie.Path != "/api" || cookie.MaxAge != 43200 {
		t.Fatal("unsafe staff cookie")
	}
	second, e := LoadConfig()
	if e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, New(s, second), "GET", "/api/auth/me", nil, cookie, ""), 200)
	t.Setenv("KITCHEN_PASSWORD", "another-ignored-password")
	second, _ = LoadConfig()
	mustStatus(t, call(t, New(s, second), "GET", "/api/auth/me", nil, cookie, ""), 200)
	mustStatus(t, call(t, a, "POST", "/api/auth/logout", map[string]string{}, cookie, config.Origin), 200)
	mustStatus(t, call(t, New(s, second), "GET", "/api/auth/me", nil, cookie, ""), 401)
	mustStatus(t, call(t, a, "POST", "/api/kitchen/login", map[string]string{"password": "ignored-legacy-password"}, nil, config.Origin), 401)
}
