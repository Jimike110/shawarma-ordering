package app

import (
	"encoding/json"
	"errors"

	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TelegramCheckout struct {
	IntentID string `json:"intent_id,omitempty"`
}

type telegramTokenKey struct{}

func telegramContext(ctx context.Context, r *http.Request) context.Context {
	return context.WithValue(ctx, telegramTokenKey{}, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
}

func (s *Store) telegramRecipient(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (int64, error) {
	token, _ := ctx.Value(telegramTokenKey{}).(string)
	if len(token) != 43 {
		return 0, problem(401, "Откройте приложение заново через Telegram.")
	}
	var id int64
	e := q.QueryRowContext(ctx, "SELECT recipient FROM telegram_sessions WHERE token_hash=$1 AND expires_at>now()", Hash(token)).Scan(&id)
	if e == sql.ErrNoRows {
		return 0, problem(401, "Откройте приложение заново через Telegram.")
	}
	return id, e
}

// Validate only Telegram's signed raw launch data; no profile is persisted.
func validateTelegramInit(raw, token string, now time.Time) (int64, time.Time, error) {
	bad := errors.New("invalid Telegram launch")
	if len(raw) == 0 || len(raw) > 16384 || token == "" {
		return 0, time.Time{}, bad
	}
	v, e := url.ParseQuery(raw)
	if e != nil {
		return 0, time.Time{}, bad
	}
	keys := []string{}
	for k, values := range v {
		if len(values) != 1 {
			return 0, time.Time{}, bad
		}
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	parts := []string{}
	for _, k := range keys {
		parts = append(parts, k+"="+v.Get(k))
	}
	key := hmac.New(sha256.New, []byte("WebAppData"))
	key.Write([]byte(token))
	mac := hmac.New(sha256.New, key.Sum(nil))
	mac.Write([]byte(strings.Join(parts, "\n")))
	supplied, e := hex.DecodeString(v.Get("hash"))
	if e != nil || !hmac.Equal(supplied, mac.Sum(nil)) {
		return 0, time.Time{}, bad
	}
	seconds, e := strconv.ParseInt(v.Get("auth_date"), 10, 64)
	date := time.Unix(seconds, 0)
	if e != nil || date.Before(now.Add(-time.Hour)) || date.After(now.Add(time.Minute)) {
		return 0, time.Time{}, bad
	}
	var user struct {
		ID int64 `json:"id"`
	}
	if json.Unmarshal([]byte(v.Get("user")), &user) != nil || user.ID < 1 {
		return 0, time.Time{}, bad
	}
	return user.ID, date, nil
}
