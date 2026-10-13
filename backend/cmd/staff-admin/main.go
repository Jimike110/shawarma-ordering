package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"io"
	"log"
	"os"
	"shawarma/internal/app"
	"strings"
	"time"
)

func main() {
	mode := flag.String("mode", "bootstrap", "bootstrap, recovery or import")
	username := flag.String("username", "", "account login")
	name := flag.String("name", "", "owner display name")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, e := app.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		log.Fatal(e)
	}
	defer store.DB.Close()
	switch *mode {
	case "bootstrap", "recovery":
		raw, e := io.ReadAll(io.LimitReader(os.Stdin, 1025))
		if e != nil {
			log.Fatal(e)
		}
		password := strings.TrimRight(string(raw), "\r\n")
		if *mode == "bootstrap" {
			e = store.BootstrapOwner(ctx, *username, *name, password)
		} else {
			e = store.RecoverOwner(ctx, *username, password)
		}
		if e != nil {
			log.Fatal(e)
		}
	case "import":
		var users map[string]string
		if e = json.Unmarshal([]byte(os.Getenv("STAFF_USERS")), &users); e != nil || len(users) == 0 {
			log.Fatal("Provide STAFF_USERS explicitly for import")
		}
		for username, hash := range users {
			if cost, e := bcrypt.Cost([]byte(hash)); e != nil || cost < 10 {
				log.Fatal("Import requires bcrypt cost >= 10")
			}
			_, e = store.SaveAccount(ctx, 0, app.UserInput{Username: username, DisplayName: username, Active: true, Memberships: []app.Membership{{StoreID: 1, Role: "worker"}}}, hash, true)
			if e != nil {
				log.Fatal(e)
			}
		}
	default:
		log.Fatal("Unknown mode")
	}
	fmt.Println("Account operation completed. No passwords are logged.")
}
