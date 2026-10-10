package main

import (
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"io"
	"log"
	"os"
	"strings"
)

// Read passwords from stdin, never process arguments or logs.
func main() {
	raw, e := io.ReadAll(io.LimitReader(os.Stdin, 1024))
	if e != nil {
		log.Fatal("cannot read stdin")
	}
	password := strings.TrimRight(string(raw), "\r\n")
	if len(password) < 12 || len(password) > 72 {
		log.Fatal("password must have 12 to 72 UTF-8 bytes")
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if e != nil {
		log.Fatal("cannot generate password hash")
	}
	fmt.Println(string(hash))
}
