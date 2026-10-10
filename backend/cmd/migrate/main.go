package main

import (
	"context"
	"log"
	"os"
	"shawarma/internal/app"
	"time"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	s, e := app.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		log.Fatal(e)
	}
	defer s.DB.Close()
	if e = s.Migrate(ctx); e != nil {
		log.Fatal(e)
	}
	log.Print("Schema and demonstration menu are ready.")
}
