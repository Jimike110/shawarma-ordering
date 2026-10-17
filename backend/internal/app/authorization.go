package app

import (
	"net/http"

	"database/sql"

	"context"
	"strconv"

	"time"
)

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
		var id, version, deviceID int64
		e = a.Store.DB.QueryRowContext(r.Context(), "SELECT user_id,account_version,COALESCE(device_id,0) FROM sessions WHERE token_hash=$1 AND expires_at>now() AND user_id IS NOT NULL", Hash(c.Value)).Scan(&id, &version, &deviceID)
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
		if u.AccountType == "kitchen" {
			var valid bool
			e = a.Store.DB.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM kitchen_devices WHERE id=$1 AND state='approved' AND user_id=$2 AND store_id=$3 AND account_version=$4 AND login_until>now())", deviceID, u.ID, u.KitchenStoreID, u.Version).Scan(&valid)
			if e != nil {
				fail(w, e)
				return
			}
			if !valid {
				a.cookie(w, "", -1)
				reply(w, 401, map[string]string{"error": "Доступ устройства завершён. Войдите снова."})
				return
			}
			u.DeviceID = deviceID
			if e = a.Store.DB.QueryRowContext(r.Context(), "SELECT label FROM kitchen_devices WHERE id=$1", deviceID).Scan(&u.DeviceLabel); e != nil {
				fail(w, e)
				return
			}
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
