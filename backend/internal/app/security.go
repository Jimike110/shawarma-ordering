package app

import (
	"encoding/hex"

	"net"

	"crypto/sha256"

	"crypto/hmac"
	"crypto/rand"

	"context"
	"encoding/base64"
	"net/http"
)

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

func Hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (s *Store) Allow(ctx context.Context, key string, max int) (bool, error) {
	var n int
	e := s.DB.QueryRowContext(ctx, `INSERT INTO rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET
 attempts=CASE WHEN rate_limits.window_start<now()-interval '10 minutes' THEN 1 ELSE rate_limits.attempts+1 END,
 window_start=CASE WHEN rate_limits.window_start<now()-interval '10 minutes' THEN now() ELSE rate_limits.window_start END RETURNING attempts`, key).Scan(&n)
	return n <= max, e
}
