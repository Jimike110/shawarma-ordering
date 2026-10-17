package app

import (
	"crypto/subtle"

	"strings"

	"crypto/rand"
	"encoding/base64"
	"golang.org/x/crypto/bcrypt"
	"regexp"
	"unicode/utf8"

	"fmt"
	"golang.org/x/crypto/argon2"
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{2,59}$`)

func NormalizeUsername(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func ValidatePassword(s string) error {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) < 15 || utf8.RuneCountInString(s) > 128 || len(s) > 512 {
		return problem(400, "Пароль: от 15 до 128 символов. Можно использовать длинную фразу.")
	}
	return nil
}

func PasswordHash(password string) (string, error) {
	if e := ValidatePassword(password); e != nil {
		return "", e
	}
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		return "", e
	}
	key := argon2.IDKey([]byte(password), salt, 2, 19456, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=19456,t=2,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func VerifyPassword(hash, password string) bool {
	if len(password) > 512 {
		return false
	}
	if strings.HasPrefix(hash, "$2") {
		return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
	}
	p := strings.Split(hash, "$")
	if len(p) != 6 || p[1] != "argon2id" || p[2] != "v=19" || p[3] != "m=19456,t=2,p=1" {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(p[4])
	if e != nil || len(salt) != 16 {
		return false
	}
	key, e := base64.RawStdEncoding.DecodeString(p[5])
	if e != nil || len(key) != 32 {
		return false
	}
	return subtle.ConstantTimeCompare(key, argon2.IDKey([]byte(password), salt, 2, 19456, 1, 32)) == 1
}
