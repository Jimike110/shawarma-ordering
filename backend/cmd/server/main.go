package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"shawarma/internal/app"
	"strconv"
	"syscall"
	"time"
)

func main() {
	config, e := app.LoadConfig()
	if e != nil {
		log.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, e := app.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		log.Fatal(e)
	}
	defer store.DB.Close()
	retention := 0
	if raw := os.Getenv("ORDER_RETENTION_DAYS"); raw != "" {
		retention, e = strconv.Atoi(raw)
		if e != nil || (retention != 0 && (retention < 30 || retention > 3650)) {
			log.Fatal("ORDER_RETENTION_DAYS must be 0 (disabled), or 30 to 3650")
		}
	}
	if os.Getenv("AUTO_MIGRATE") == "true" {
		if e = store.Migrate(ctx); e != nil {
			log.Fatal(e)
		}
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	server := &http.Server{Addr: addr, Handler: app.New(store, config), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	stop := make(chan os.Signal, 1)
	maintenanceContext, stopMaintenance := context.WithCancel(context.Background())
	defer stopMaintenance()
	maintenanceDone := make(chan struct{})
	go func() {
		defer close(maintenanceDone)
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			job, finish := context.WithTimeout(maintenanceContext, 30*time.Second)
			if err := store.Maintenance(job, retention); err != nil && maintenanceContext.Err() == nil {
				log.Printf("database maintenance failed: %v", err)
			}
			finish()
			select {
			case <-maintenanceContext.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		stopMaintenance()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	log.Printf("Shawarma API listening on %s", addr)
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
	stopMaintenance()
	<-maintenanceDone
}
