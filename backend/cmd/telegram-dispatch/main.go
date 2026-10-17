package main

import (
	"context"
	"log"
	"os"
	"shawarma/internal/app"
	"time"
)

func main() {
	c, e := app.LoadConfig()
	if e != nil {
		log.Fatal("Invalid configuration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	s, e := app.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		log.Fatal("Database unavailable")
	}
	defer s.DB.Close()
	n, e := app.New(s, c).DispatchTelegram(ctx, 10)
	if e != nil {
		log.Fatalf("Dispatch failed (%T)", e)
	}
	log.Printf("Processed %d notification jobs", n)
}
