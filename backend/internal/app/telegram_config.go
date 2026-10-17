package app

import (
	"net/http"

	"os"
)

type TelegramConfig struct {
	Enabled                                              bool
	BotToken, BotUsername, WebhookSecret, DispatchSecret string
	// Client is injectable for isolated fake-Bot-API tests. Production always uses api.telegram.org.
	Client *http.Client
}

func loadTelegramConfig() TelegramConfig {
	return TelegramConfig{Enabled: os.Getenv("TELEGRAM_ENABLED") == "true", BotToken: os.Getenv("TELEGRAM_BOT_TOKEN"), BotUsername: os.Getenv("TELEGRAM_BOT_USERNAME"), WebhookSecret: os.Getenv("TELEGRAM_WEBHOOK_SECRET"), DispatchSecret: os.Getenv("TELEGRAM_DISPATCH_SECRET")}
}

func (c TelegramConfig) configured() bool {
	if !c.Enabled || c.BotToken == "" || len(c.WebhookSecret) < 32 || len(c.DispatchSecret) < 32 || len(c.BotUsername) < 5 || len(c.BotUsername) > 32 {
		return false
	}
	for _, r := range c.BotUsername {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}
