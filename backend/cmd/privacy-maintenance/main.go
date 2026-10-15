// Explicit administration only: no migrations, no automatic activation, preview by default.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"shawarma/internal/app"
	"time"
)

func run() error {
	mode := flag.String("mode", "preview", "preview, apply, replay, restore (offline replay + drain), or compact")
	batch := flag.Int("batch", 200, "maximum records per transaction (1..1000)")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	store, e := app.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return fmt.Errorf("database unavailable (%T)", e)
	}
	defer store.DB.Close()
	switch *mode {
	case "compact":
		return store.CompactPrivacyJournal(ctx)
	case "preview":
		p, e := store.RetentionPreview(ctx)
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(p)
	case "apply":
		n, e := store.PrivacyMaintenance(ctx, *batch)
		if e != nil {
			return e
		}
		fmt.Printf("Processed %d personal/receipt/staff records.\n", n)
		return nil
	case "replay", "restore":
		n, e := store.ReplayPrivacyJournal(ctx)
		if e != nil {
			return e
		}
		fmt.Printf("Replayed %d deletion intentions.\n", n)
		if *mode == "restore" {
			for {
				p, e := store.RetentionPreview(ctx)
				if e != nil {
					return e
				}
				if !p.Enabled {
					return fmt.Errorf("restore remains offline: explicitly activate reviewed retention before draining")
				}
				if p.PersonalFields+p.Receipts+p.DisabledStaff+p.SecurityCounters+p.AuditRecords+p.Evidence+p.Requests+p.ExpiredSessions+p.DestructionEvidence == 0 {
					break
				}
				if _, e = store.PrivacyMaintenance(ctx, *batch); e != nil {
					return e
				}
			}
		}
		return nil
	default:
		return fmt.Errorf("unknown mode")
	}
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintf(os.Stderr, "Privacy maintenance stopped: %s\n", safe(e))
		os.Exit(1)
	}
}
func safe(e error) string {
	if p, ok := e.(*app.Problem); ok {
		return p.Message
	}
	switch e.Error() {
	case "retention disabled: preview and explicitly activate it first", "privacy maintenance already running", "batch must be 1..1000", "privacy key and external journal required", "deletion journal authentication failed", "invalid deletion journal; restore must remain offline", "restore remains offline: explicitly activate reviewed retention before draining":
		return e.Error()
	}
	return fmt.Sprintf("operation failed (%T); keep restore offline and inspect configuration", e)
}
