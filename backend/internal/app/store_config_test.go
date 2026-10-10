package app

import (
	"context"
	"strings"
	"testing"
)

func TestOpenRequiresExplicitDatabaseURL(t *testing.T) {
	// Driver PG* defaults must never select an unintended database when the
	// application's required DATABASE_URL is missing.
	t.Setenv("PGHOST", "unintended-fallback.invalid")
	t.Setenv("PGUSER", "unintended-user")
	for _, dsn := range []string{"", " \t\n"} {
		store, err := Open(context.Background(), dsn)
		if store != nil {
			store.DB.Close()
			t.Fatal("opened a database without an explicit connection URL")
		}
		if err == nil || !strings.Contains(err.Error(), "DATABASE_URL is not set") {
			t.Fatalf("expected a missing DATABASE_URL error, got %v", err)
		}
	}
}
