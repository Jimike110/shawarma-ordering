package app

import (
	"time"

	"database/sql"

	"context"

	"net/http"

	"fmt"
)

func (a *API) cookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: "staff_session", Value: token, Path: "/api", HttpOnly: true, Secure: a.Config.Secure, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != a.Config.Origin {
		reply(w, 403, map[string]string{"error": "Недопустимый источник запроса."})
		return
	}
	var input struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DeviceLabel string `json:"device_label"`
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
	if u.AccountType == "kitchen" {
		a.kitchenLogin(w, r, u, input.DeviceLabel)
		return
	}
	// An explicit personal login must not silently restore a previous shared login.
	if e = a.clearDeviceLogin(r.Context(), r); e != nil {
		fail(w, e)
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

func (a *API) me(w http.ResponseWriter, r *http.Request) { reply(w, 200, actor(r.Context())) }

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if e := a.clearDeviceLogin(r.Context(), r); e != nil {
		fail(w, e)
		return
	}
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
	if actor(r.Context()).AccountType == "kitchen" {
		reply(w, 403, map[string]string{"error": "Пароль точки меняет только владелец."})
		return
	}
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
