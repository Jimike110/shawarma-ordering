package app

import (
	"net/url"

	"errors"

	"os"
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
