package app

import (
	"context"
	"errors"
	"testing"
	"time"
)

type maintenanceResult struct {
	count int
	err   error
}

func waitForMaintenanceCheckoutLock(t *testing.T, s *Store, done <-chan maintenanceResult) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		err := s.DB.QueryRowContext(ctx, `SELECT EXISTS (
 SELECT 1 FROM pg_locks waiting JOIN pg_locks singleton ON singleton.pid=waiting.pid
 WHERE waiting.locktype='advisory' AND waiting.objid=184020 AND NOT waiting.granted
 AND singleton.locktype='advisory' AND singleton.objid=184021 AND singleton.granted
 AND waiting.database=(SELECT oid FROM pg_database WHERE datname=current_database()))`).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case result := <-done:
			t.Fatalf("maintenance returned while checkout still held its lock: %v", result.err)
		case <-ctx.Done():
			t.Fatal("maintenance never waited for checkout")
		case <-ticker.C:
		}
	}
}

func TestPrivacyMaintenanceWaitsForCheckoutAndRejectsOtherWorkers(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := s.DB.ExecContext(ctx, "UPDATE privacy_settings SET retention_enabled=true"); err != nil {
		t.Fatal(err)
	}
	order, err := s.CreateOrder(ctx, checkout(), "privacy-lock-fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.ExecContext(ctx, "UPDATE orders SET status='completed',closed_at=now()-interval '2 years' WHERE id=$1", order.ID); err != nil {
		t.Fatal(err)
	}
	checkoutTx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer checkoutTx.Rollback()
	if _, err = checkoutTx.ExecContext(ctx, "SELECT pg_advisory_xact_lock_shared(184020)"); err != nil {
		t.Fatal(err)
	}
	done := make(chan maintenanceResult, 1)
	go func() {
		n, err := s.PrivacyMaintenance(ctx, 10)
		done <- maintenanceResult{n, err}
	}()
	waitForMaintenanceCheckoutLock(t, s, done)
	if _, err = s.PrivacyMaintenance(ctx, 10); err == nil || err.Error() != "privacy maintenance already running" {
		t.Fatalf("competing maintenance was not rejected: %v", err)
	}
	if err = checkoutTx.Commit(); err != nil {
		t.Fatal(err)
	}
	result := <-done
	if result.err != nil || result.count != 1 {
		t.Fatalf("maintenance did not resume after checkout: %+v", result)
	}
	if n, err := s.PrivacyMaintenance(ctx, 10); err != nil || n != 0 {
		t.Fatalf("repeat maintenance was not idempotent: %d, %v", n, err)
	}
}

func TestPrivacyMaintenanceCheckoutWaitCanBeCancelled(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.DB.Exec("UPDATE privacy_settings SET retention_enabled=true"); err != nil {
		t.Fatal(err)
	}
	checkoutTx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer checkoutTx.Rollback()
	if _, err = checkoutTx.ExecContext(ctx, "SELECT pg_advisory_xact_lock_shared(184020)"); err != nil {
		t.Fatal(err)
	}
	workerCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	done := make(chan maintenanceResult, 1)
	go func() {
		n, err := s.PrivacyMaintenance(workerCtx, 10)
		done <- maintenanceResult{n, err}
	}()
	waitForMaintenanceCheckoutLock(t, s, done)
	cancel()
	result := <-done
	if !errors.Is(result.err, context.Canceled) {
		t.Fatalf("maintenance did not honor cancellation: %v", result.err)
	}
	if err = checkoutTx.Commit(); err != nil {
		t.Fatal(err)
	}
	// database/sql may roll back a cancelled transaction asynchronously. Wait for
	// PostgreSQL to acknowledge that rollback before simulating the next run.
	releaseCtx, releaseCancel := context.WithTimeout(ctx, 5*time.Second)
	defer releaseCancel()
	for {
		var held bool
		err = s.DB.QueryRowContext(releaseCtx, `SELECT EXISTS(SELECT 1 FROM pg_locks
 WHERE locktype='advisory' AND objid=184021 AND granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()))`).Scan(&held)
		if err != nil {
			t.Fatal(err)
		}
		if !held {
			break
		}
		select {
		case <-releaseCtx.Done():
			t.Fatal("cancelled maintenance retained its lock")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if _, err = s.PrivacyMaintenance(releaseCtx, 10); err != nil {
		t.Fatalf("cancelled maintenance retained its lock: %v", err)
	}
}
