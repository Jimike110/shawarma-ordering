package app

import (
	"context"
	"database/sql"
	"os"
	"shawarma/internal/database"
)

type Store struct {
	DB          *sql.DB
	PrivacyKey  string
	JournalPath string
	Telegram    TelegramConfig
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	db, err := database.Open(ctx, dsn)
	if err != nil {
		return nil, err
	}
	return &Store{DB: db, PrivacyKey: os.Getenv("SESSION_SECRET"), JournalPath: os.Getenv("PRIVACY_JOURNAL_PATH")}, nil
}
func (s *Store) Migrate(ctx context.Context) error { return database.Migrate(ctx, s.DB) }
