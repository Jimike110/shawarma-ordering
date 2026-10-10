package app

import (
	"bytes"
	"golang.org/x/crypto/bcrypt"
	"strings"
	"testing"
)

func sessionConfigEnv(t *testing.T) {
	t.Helper()
	t.Setenv("PUBLIC_ORIGIN", "https://shop.example")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 64))
	t.Setenv("STAFF_USERS", "")
	t.Setenv("KITCHEN_PASSWORD_HASH", "")
	t.Setenv("KITCHEN_PASSWORD", "session-test-password")
}

func mustLoadSessionConfig(t *testing.T) Config {
	t.Helper()
	c, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestSharedPasswordSessionAcrossInstances(t *testing.T) {
	store := testStore(t)
	sessionConfigEnv(t)
	first := mustLoadSessionConfig(t)
	second := mustLoadSessionConfig(t)
	if bytes.Equal(first.PasswordHash, second.PasswordHash) {
		t.Fatal("expected separately salted bcrypt hashes")
	}
	firstAPI := New(store, first)
	login := call(t, firstAPI, "POST", "/api/kitchen/login", map[string]string{"password": "session-test-password"}, nil, first.Origin)
	mustStatus(t, login, 200)
	cookies := login.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure || cookies[0].MaxAge != 43200 {
		t.Fatal("missing secure 12-hour session cookie")
	}
	cookie := cookies[0]
	secondAPI := New(store, second)
	mustStatus(t, call(t, secondAPI, "GET", "/api/kitchen/session", nil, cookie, ""), 200)
	mustStatus(t, call(t, secondAPI, "GET", "/api/kitchen/orders", nil, cookie, ""), 200)

	t.Setenv("KITCHEN_PASSWORD", "changed-test-password")
	mustStatus(t, call(t, New(store, mustLoadSessionConfig(t)), "GET", "/api/kitchen/session", nil, cookie, ""), 401)
	t.Setenv("KITCHEN_PASSWORD", "session-test-password")
	t.Setenv("SESSION_SECRET", strings.Repeat("r", 64))
	mustStatus(t, call(t, New(store, mustLoadSessionConfig(t)), "GET", "/api/kitchen/session", nil, cookie, ""), 401)

	// Logging out through either instance revokes the database session for both.
	mustStatus(t, call(t, secondAPI, "POST", "/api/kitchen/logout", map[string]string{}, cookie, second.Origin), 200)
	mustStatus(t, call(t, firstAPI, "GET", "/api/kitchen/session", nil, cookie, ""), 401)
}

func TestPrehashedPasswordSessionAcrossInstances(t *testing.T) {
	store := testStore(t)
	sessionConfigEnv(t)
	hash, err := bcrypt.GenerateFromPassword([]byte("session-test-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("KITCHEN_PASSWORD_HASH", string(hash))
	first := mustLoadSessionConfig(t)
	login := call(t, New(store, first), "POST", "/api/kitchen/login", map[string]string{"password": "session-test-password"}, nil, first.Origin)
	mustStatus(t, login, 200)
	cookie := login.Result().Cookies()[0]
	mustStatus(t, call(t, New(store, mustLoadSessionConfig(t)), "GET", "/api/kitchen/session", nil, cookie, ""), 200)
	changed, err := bcrypt.GenerateFromPassword([]byte("changed-test-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("KITCHEN_PASSWORD_HASH", string(changed))
	mustStatus(t, call(t, New(store, mustLoadSessionConfig(t)), "GET", "/api/kitchen/session", nil, cookie, ""), 401)
}
