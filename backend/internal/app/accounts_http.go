package app

import (
	"net/http"
)

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
