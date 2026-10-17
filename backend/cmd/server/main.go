package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"shawarma/internal/app"
	"syscall"
	"time"
)

func main() {
	config, e := app.LoadConfig()
	if e != nil {
		log.Fatalf("configuration unavailable (%T)", e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, e := app.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		log.Fatalf("database unavailable (%T)", e)
	}
	defer store.DB.Close()
	if raw := os.Getenv("ORDER_RETENTION_DAYS"); raw != "" && raw != "0" {
		log.Fatal("ORDER_RETENTION_DAYS deletion is retired; configure reviewed privacy retention and the maintenance CLI")
	}
	if os.Getenv("AUTO_MIGRATE") == "true" {
		if e = store.Migrate(ctx); e != nil {
			log.Fatalf("migration failed (%T)", e)
		}
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	api := app.New(store, config)
	server := &http.Server{Addr: addr, Handler: api, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	stop := make(chan os.Signal, 1)
	maintenanceContext, stopMaintenance := context.WithCancel(context.Background())
	defer stopMaintenance()
	telegramDone := make(chan struct{})
	go func() {
		defer close(telegramDone)
		if !config.Telegram.Enabled {
			return
		}
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			job, finish := context.WithTimeout(maintenanceContext, 20*time.Second)
			if _, err := api.DispatchTelegram(job, 10); err != nil && maintenanceContext.Err() == nil {
				log.Printf("Telegram dispatch unavailable (%T)", err)
			}
			finish()
			select {
			case <-maintenanceContext.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	maintenanceDone := make(chan struct{})
	go func() {
		defer close(maintenanceDone)
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			job, finish := context.WithTimeout(maintenanceContext, 30*time.Second)
			if err := store.Maintenance(job, 0); err != nil && maintenanceContext.Err() == nil {
				log.Printf("security maintenance failed (%T)", err)
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
	<-telegramDone
}
