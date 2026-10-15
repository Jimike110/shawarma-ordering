package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Membership struct {
	StoreID int64  `json:"store_id"`
	Role    string `json:"role"`
}
type Account struct {
	ID               int64        `json:"id"`
	Username         string       `json:"username"`
	DisplayName      string       `json:"display_name"`
	Phone            string       `json:"phone"`
	Email            string       `json:"email"`
	Owner            bool         `json:"owner"`
	Active           bool         `json:"active"`
	PasswordRequired bool         `json:"password_required"`
	Memberships      []Membership `json:"memberships"`
	LastLogin        *time.Time   `json:"last_login_at"`
	PasswordHash     string       `json:"-"`
	TemporaryUntil   *time.Time   `json:"-"`
	Version          int64        `json:"-"`
}
type accountKey struct{}
type storeKey struct{}

func shopID(ctx context.Context) int64 {
	if id, ok := ctx.Value(storeKey{}).(int64); ok {
		return id
	}
	return 1
}
func shopContext(ctx context.Context, id int64) context.Context {
	return context.WithValue(ctx, storeKey{}, id)
}
func actor(ctx context.Context) Account { u, _ := ctx.Value(accountKey{}).(Account); return u }
func (u Account) Role(id int64) string {
	if u.Owner {
		return "owner"
	}
	for _, m := range u.Memberships {
		if m.StoreID == id {
			return m.Role
		}
	}
	return ""
}

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

const accountCols = "id,username,display_name,phone,email,owner,active,password_required,last_login_at,password_hash,temporary_until,version"

func scanAccount(row interface{ Scan(...any) error }) (Account, error) {
	var u Account
	e := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Phone, &u.Email, &u.Owner, &u.Active, &u.PasswordRequired, &u.LastLogin, &u.PasswordHash, &u.TemporaryUntil, &u.Version)
	u.Memberships = []Membership{}
	return u, e
}
func (s *Store) memberships(ctx context.Context, u *Account) error {
	rows, e := s.DB.QueryContext(ctx, "SELECT store_id,role FROM staff_memberships WHERE user_id=$1 ORDER BY store_id", u.ID)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var m Membership
		if e = rows.Scan(&m.StoreID, &m.Role); e != nil {
			return e
		}
		u.Memberships = append(u.Memberships, m)
	}
	return rows.Err()
}
func (s *Store) account(ctx context.Context, id int64) (Account, error) {
	u, e := scanAccount(s.DB.QueryRowContext(ctx, "SELECT "+accountCols+" FROM staff_accounts WHERE id=$1", id))
	if e == nil {
		e = s.memberships(ctx, &u)
	}
	return u, e
}
func (s *Store) Accounts(ctx context.Context) ([]Account, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT "+accountCols+" FROM staff_accounts ORDER BY active DESC,display_name,id")
	if e != nil {
		return nil, e
	}
	users := []Account{}
	for rows.Next() {
		u, e := scanAccount(rows)
		if e != nil {
			rows.Close()
			return nil, e
		}
		users = append(users, u)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for i := range users {
		if e = s.memberships(ctx, &users[i]); e != nil {
			return nil, e
		}
	}
	return users, nil
}

func (a *API) cookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: "staff_session", Value: token, Path: "/api", HttpOnly: true, Secure: a.Config.Secure, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != a.Config.Origin {
		reply(w, 403, map[string]string{"error": "Недопустимый источник запроса."})
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) || !a.limit(w, r, "login", 10) {
		return
	}
	username := NormalizeUsername(input.Username)
	ok, e := a.Store.Allow(r.Context(), "login-user:"+a.Store.privacyDigest("rate-username", username), 10)
	if e != nil {
		fail(w, e)
		return
	}
	if !ok {
		w.Header().Set("Retry-After", "600")
		reply(w, 429, map[string]string{"error": "Слишком много попыток. Попробуйте через 10 минут."})
		return
	}
	u, e := scanAccount(a.Store.DB.QueryRowContext(r.Context(), "SELECT "+accountCols+" FROM staff_accounts WHERE username=$1", username))
	if e != nil && e != sql.ErrNoRows {
		fail(w, e)
		return
	}
	hash := u.PasswordHash
	if e == sql.ErrNoRows {
		hash = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	}
	if !VerifyPassword(hash, input.Password) || e != nil || !u.Active || (u.PasswordRequired && (u.TemporaryUntil == nil || !time.Now().Before(*u.TemporaryUntil))) {
		reply(w, 401, map[string]string{"error": "Неверный логин или пароль."})
		return
	}
	token := randomToken()
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var version int64
	var active bool
	if e = tx.QueryRowContext(r.Context(), "SELECT version,active FROM staff_accounts WHERE id=$1 FOR UPDATE", u.ID).Scan(&version, &active); e != nil {
		fail(w, e)
		return
	}
	if !active || version != u.Version {
		reply(w, 401, map[string]string{"error": "Неверный логин или пароль."})
		return
	}
	lifetime := 43200
	if u.PasswordRequired {
		lifetime = 900
	}
	_, e = tx.ExecContext(r.Context(), "INSERT INTO sessions(token_hash,expires_at,user_id,account_version,staff_name,confirmed_at) VALUES($1,now()+($2*interval '1 second'),$3,$4,$5,now())", Hash(token), lifetime, u.ID, u.Version, u.Username)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "UPDATE staff_accounts SET last_login_at=now() WHERE id=$1", u.ID)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "kitchen_session", Path: "/api/kitchen", HttpOnly: true, Secure: a.Config.Secure, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	a.cookie(w, token, lifetime)
	if e = a.Store.memberships(r.Context(), &u); e != nil {
		fail(w, e)
		return
	}
	a.me(w, r.WithContext(context.WithValue(r.Context(), accountKey{}, u)))
}
func (a *API) authenticated(next http.HandlerFunc, allowPasswordChange bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Header.Get("Origin") != a.Config.Origin {
			reply(w, 403, map[string]string{"error": "Недопустимый источник запроса."})
			return
		}
		c, e := r.Cookie("staff_session")
		if e != nil || len(c.Value) != 43 {
			reply(w, 401, map[string]string{"error": "Войдите в панель сотрудников."})
			return
		}
		var id, version int64
		e = a.Store.DB.QueryRowContext(r.Context(), "SELECT user_id,account_version FROM sessions WHERE token_hash=$1 AND expires_at>now() AND user_id IS NOT NULL", Hash(c.Value)).Scan(&id, &version)
		if e != nil && e != sql.ErrNoRows {
			fail(w, e)
			return
		}
		u, ue := a.Store.account(r.Context(), id)
		if ue != nil && ue != sql.ErrNoRows {
			fail(w, ue)
			return
		}
		if e != nil || ue != nil || !u.Active || u.Version != version || (u.PasswordRequired && (u.TemporaryUntil == nil || !time.Now().Before(*u.TemporaryUntil))) {
			a.cookie(w, "", -1)
			reply(w, 401, map[string]string{"error": "Сессия истекла. Войдите снова."})
			return
		}
		if u.PasswordRequired && !allowPasswordChange {
			reply(w, 403, map[string]string{"error": "Сначала смените временный пароль.", "code": "password_change_required"})
			return
		}
		ctx := context.WithValue(r.Context(), accountKey{}, u)
		ctx = context.WithValue(ctx, staffContextKey{}, u.Username)
		next(w, r.WithContext(ctx))
	}
}
func (a *API) me(w http.ResponseWriter, r *http.Request) { reply(w, 200, actor(r.Context())) }
func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("staff_session")
	if _, e := a.Store.DB.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", Hash(c.Value)); e != nil {
		fail(w, e)
		return
	}
	a.cookie(w, "", -1)
	reply(w, 200, map[string]bool{"authenticated": false})
}
func (a *API) recentPassword(w http.ResponseWriter, r *http.Request) bool {
	c, _ := r.Cookie("staff_session")
	var ok bool
	e := a.Store.DB.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1 AND confirmed_at>now()-interval '5 minutes')", Hash(c.Value)).Scan(&ok)
	if e != nil {
		fail(w, e)
		return false
	}
	if !ok {
		reply(w, 403, map[string]string{"error": "Подтвердите пароль для этого действия.", "code": "reauthentication_required"})
		return false
	}
	return true
}
func (a *API) reauthenticate(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Password string `json:"password"`
	}
	if !decode(w, r, &p) || !a.limit(w, r, "confirm", 10) {
		return
	}
	if !VerifyPassword(actor(r.Context()).PasswordHash, p.Password) {
		reply(w, 401, map[string]string{"error": "Неверный пароль."})
		return
	}
	c, _ := r.Cookie("staff_session")
	if _, e := a.Store.DB.ExecContext(r.Context(), "UPDATE sessions SET confirmed_at=now() WHERE token_hash=$1", Hash(c.Value)); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]bool{"confirmed": true})
}
func (a *API) changePassword(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Current  string `json:"current_password"`
		Password string `json:"password"`
	}
	if !decode(w, r, &p) || !a.limit(w, r, "password", 10) {
		return
	}
	u := actor(r.Context())
	if !VerifyPassword(u.PasswordHash, p.Current) {
		reply(w, 400, map[string]string{"error": "Неверный текущий пароль."})
		return
	}
	hash, e := PasswordHash(p.Password)
	if e != nil {
		fail(w, e)
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var version int64
	e = tx.QueryRowContext(r.Context(), "SELECT version FROM staff_accounts WHERE id=$1 AND active FOR UPDATE", u.ID).Scan(&version)
	if e != nil || version != u.Version {
		reply(w, 401, map[string]string{"error": "Войдите снова."})
		return
	}
	_, e = tx.ExecContext(r.Context(), "UPDATE staff_accounts SET password_hash=$1,password_required=false,temporary_until=NULL,version=version+1 WHERE id=$2", hash, u.ID)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE user_id=$1", u.ID)
	}
	if e == nil {
		e = audit(r.Context(), tx, "account.password_change", fmt.Sprint(u.ID))
	}
	token := randomToken()
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO sessions(token_hash,expires_at,user_id,account_version,staff_name,confirmed_at) VALUES($1,now()+interval '12 hours',$2,$3,$4,now())", Hash(token), u.ID, u.Version+1, u.Username)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	a.cookie(w, token, 43200)
	u.PasswordRequired = false
	u.TemporaryUntil = nil
	u.Version++
	reply(w, 200, u)
}
func (a *API) scoped(next http.HandlerFunc, management bool) http.HandlerFunc {
	return a.authenticated(func(w http.ResponseWriter, r *http.Request) {
		id := int64(1)
		if v := r.PathValue("storeId"); v != "" {
			var e error
			id, e = strconv.ParseInt(v, 10, 64)
			if e != nil || id < 1 {
				fail(w, ErrMissing)
				return
			}
		}
		role := actor(r.Context()).Role(id)
		if role == "" || (management && role == "worker") {
			reply(w, 403, map[string]string{"error": "Недостаточно прав для этой точки."})
			return
		}
		var archived bool
		if e := a.Store.DB.QueryRowContext(r.Context(), "SELECT archived FROM stores WHERE id=$1", id).Scan(&archived); e != nil {
			if e == sql.ErrNoRows {
				fail(w, ErrMissing)
			} else {
				fail(w, e)
			}
			return
		}
		if archived && r.Method != "GET" {
			reply(w, 403, map[string]string{"error": "Точка в архиве. Сначала верните её в черновики."})
			return
		}
		next(w, r.WithContext(shopContext(r.Context(), id)))
	}, false)
}
func (a *API) ownerOnly(next http.HandlerFunc, sensitive bool) http.HandlerFunc {
	return a.authenticated(func(w http.ResponseWriter, r *http.Request) {
		if !actor(r.Context()).Owner {
			reply(w, 403, map[string]string{"error": "Доступ только для владельца."})
			return
		}
		if sensitive && !a.recentPassword(w, r) {
			return
		}
		next(w, r)
	}, false)
}

type UserInput struct {
	Username    string       `json:"username"`
	DisplayName string       `json:"display_name"`
	Phone       string       `json:"phone"`
	Email       string       `json:"email"`
	Owner       bool         `json:"owner"`
	Active      bool         `json:"active"`
	Memberships []Membership `json:"memberships"`
}

func (s *Store) SaveAccount(ctx context.Context, id int64, in UserInput, hash string, temporary bool) (Account, error) {
	in.Username = NormalizeUsername(in.Username)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	if !usernamePattern.MatchString(in.Username) || in.DisplayName == "" || utf8.RuneCountInString(in.DisplayName) > 100 || len(in.Phone) > 50 || len(in.Email) > 254 || len(in.Memberships) > 100 {
		return Account{}, problem(400, "Проверьте логин (3–60 латинских символов), имя и контакты.")
	}
	seen := map[int64]bool{}
	for _, m := range in.Memberships {
		if m.StoreID < 1 || seen[m.StoreID] || (m.Role != "worker" && m.Role != "manager") {
			return Account{}, problem(400, "Проверьте назначения точек.")
		}
		seen[m.StoreID] = true
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Account{}, e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184015)"); e != nil {
		return Account{}, e
	}
	var duplicate bool
	if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM staff_accounts WHERE username=$1 AND id<>$2)", in.Username, id).Scan(&duplicate); e != nil {
		return Account{}, e
	}
	if duplicate {
		return Account{}, problem(409, "Этот логин уже используется.")
	}
	if id > 0 {
		var owner, active bool
		e = tx.QueryRowContext(ctx, "SELECT owner,active FROM staff_accounts WHERE id=$1 FOR UPDATE", id).Scan(&owner, &active)
		if e == sql.ErrNoRows {
			return Account{}, ErrMissing
		}
		if e != nil {
			return Account{}, e
		}
		if owner && active && (!in.Owner || !in.Active) {
			var count int
			e = tx.QueryRowContext(ctx, "SELECT count(*) FROM staff_accounts WHERE owner AND active").Scan(&count)
			if e != nil {
				return Account{}, e
			}
			if count <= 1 {
				return Account{}, problem(409, "Нельзя отключить последнего владельца.")
			}
		}
	}
	for _, m := range in.Memberships {
		if in.Owner {
			break
		}
		var exists bool
		if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM stores WHERE id=$1 AND (NOT archived OR EXISTS(SELECT 1 FROM staff_memberships WHERE user_id=$2 AND store_id=$1)))", m.StoreID, id).Scan(&exists); e != nil {
			return Account{}, e
		}
		if !exists {
			return Account{}, problem(400, "Точка назначения недоступна.")
		}
	}
	if id == 0 {
		if hash == "" {
			return Account{}, problem(400, "Нужен пароль.")
		}
		e = tx.QueryRowContext(ctx, "INSERT INTO staff_accounts(username,display_name,phone,email,owner,active,password_hash,password_required,temporary_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8 THEN now()+interval '24 hours' ELSE NULL END) RETURNING id", in.Username, in.DisplayName, in.Phone, in.Email, in.Owner, in.Active, hash, temporary).Scan(&id)
	} else {
		_, e = tx.ExecContext(ctx, "UPDATE staff_accounts SET username=$1,display_name=$2,phone=$3,email=$4,owner=$5,active=$6,version=version+1 WHERE id=$7", in.Username, in.DisplayName, in.Phone, in.Email, in.Owner, in.Active, id)
		if e == nil {
			_, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id)
		}
	}
	if e != nil {
		return Account{}, e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM staff_memberships WHERE user_id=$1", id); e != nil {
		return Account{}, e
	}
	if !in.Owner {
		for _, m := range in.Memberships {
			if _, e = tx.ExecContext(ctx, "INSERT INTO staff_memberships VALUES($1,$2,$3)", id, m.StoreID, m.Role); e != nil {
				return Account{}, e
			}
		}
	}
	details, _ := json.Marshal(map[string]any{"owner": in.Owner, "active": in.Active, "memberships": in.Memberships})
	if e = auditDetails(ctx, tx, "account.save", fmt.Sprint(id), details); e != nil {
		return Account{}, e
	}
	if e = tx.Commit(); e != nil {
		return Account{}, e
	}
	return s.account(ctx, id)
}
func (s *Store) ResetPassword(ctx context.Context, id int64, hash string, temporary bool) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	result, e := tx.ExecContext(ctx, "UPDATE staff_accounts SET password_hash=$1,password_required=$2,temporary_until=CASE WHEN $2 THEN now()+interval '24 hours' ELSE NULL END,version=version+1 WHERE id=$3", hash, temporary, id)
	if e != nil {
		return e
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrMissing
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
		return e
	}
	if e = audit(ctx, tx, "account.password_reset", fmt.Sprint(id)); e != nil {
		return e
	}
	return tx.Commit()
}
func (a *API) listAccounts(w http.ResponseWriter, r *http.Request) {
	users, e := a.Store.Accounts(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, users)
}
func (a *API) saveAccount(w http.ResponseWriter, r *http.Request) {
	var in UserInput
	if !decode(w, r, &in) {
		return
	}
	id := int64(0)
	if r.Method == "PUT" {
		var ok bool
		id, ok = parseID(w, r)
		if !ok {
			return
		}
	}
	password := ""
	hash := ""
	if id == 0 {
		password = randomToken()[:24]
		var e error
		hash, e = PasswordHash(password)
		if e != nil {
			fail(w, e)
			return
		}
	}
	u, e := a.Store.SaveAccount(r.Context(), id, in, hash, true)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]any{"user": u, "temporary_password": password})
}
func (a *API) resetPassword(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if id == actor(r.Context()).ID {
		fail(w, problem(409, "Свой пароль измените через «Смена пароля», подтвердив текущий пароль."))
		return
	}
	password := randomToken()[:24]
	hash, e := PasswordHash(password)
	if e == nil {
		e = a.Store.ResetPassword(r.Context(), id, hash, true)
	}
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]string{"temporary_password": password})
}

func (s *Store) BootstrapOwner(ctx context.Context, username, name, password string) error {
	hash, e := PasswordHash(password)
	if e != nil {
		return e
	}
	username = NormalizeUsername(username)
	if !usernamePattern.MatchString(username) || strings.TrimSpace(name) == "" {
		return problem(400, "Проверьте логин и имя владельца.")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184015)"); e != nil {
		return e
	}
	var count int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM staff_accounts WHERE owner").Scan(&count); e != nil {
		return e
	}
	if count != 0 {
		return problem(409, "Владелец уже создан. Используйте recovery.")
	}
	var id int64
	e = tx.QueryRowContext(ctx, "INSERT INTO staff_accounts(username,display_name,owner,password_hash) VALUES($1,$2,true,$3) RETURNING id", username, name, hash).Scan(&id)
	if e != nil {
		return e
	}
	if e = audit(ctx, tx, "account.bootstrap", fmt.Sprint(id)); e != nil {
		return e
	}
	return tx.Commit()
}

// Recovery is available only to a database administrator through the CLI.
func (s *Store) RecoverOwner(ctx context.Context, username, password string) error {
	hash, e := PasswordHash(password)
	if e != nil {
		return e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184015)"); e != nil {
		return e
	}
	var id int64
	e = tx.QueryRowContext(ctx, "UPDATE staff_accounts SET active=true,password_hash=$1,password_required=false,temporary_until=NULL,version=version+1 WHERE username=$2 AND owner RETURNING id", hash, NormalizeUsername(username)).Scan(&id)
	if e == sql.ErrNoRows {
		return ErrMissing
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
		return e
	}
	if e = audit(ctx, tx, "account.recovery", fmt.Sprint(id)); e != nil {
		return e
	}
	return tx.Commit()
}
