package database

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
)

//go:embed schema.sql migrations/*.sql
var migrations embed.FS

// Sources exposes read-only embedded migration files for upgrade rehearsals.
func Sources() fs.FS { return migrations }
func Migrate(ctx context.Context, db *sql.DB) error {
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184014)"); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); e != nil {
		return e
	}
	files := []string{"schema.sql"}
	entries, e := migrations.ReadDir("migrations")
	if e != nil {
		return e
	}
	for _, entry := range entries {
		files = append(files, "migrations/"+entry.Name())
	}
	for _, file := range files {
		var applied bool
		if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", file).Scan(&applied); e != nil {
			return e
		}
		if applied {
			continue
		}
		body, err := migrations.ReadFile(file)
		if err != nil {
			return err
		}
		if _, e = tx.ExecContext(ctx, string(body)); e != nil {
			return fmt.Errorf("migration %s: %w", file, e)
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", file); e != nil {
			return e
		}
	}
	return tx.Commit()
}
