package app

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const kitchenRemember = 30 * 24 * time.Hour

func (a *API) deviceCookie(w http.ResponseWriter, secret string) {
	http.SetCookie(w, &http.Cookie{Name: "kitchen_device", Value: secret, Path: "/api", HttpOnly: true, Secure: a.Config.Secure, SameSite: http.SameSiteStrictMode, MaxAge: 365 * 86400})
}
func deviceSecret(r *http.Request) string {
	c, e := r.Cookie("kitchen_device")
	if e != nil || len(c.Value) != 43 {
		return ""
	}
	return c.Value
}
func (a *API) clearDeviceLogin(ctx context.Context, r *http.Request) error {
	secret := deviceSecret(r)
	if secret == "" {
		return nil
	}
	tx, e := a.Store.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var id int64
	e = tx.QueryRowContext(ctx, "SELECT id FROM kitchen_devices WHERE secret_hash=$1 FOR UPDATE", Hash(secret)).Scan(&id)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE device_id=$1", id); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM kitchen_alert_tokens WHERE device_id=$1", id); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE kitchen_devices SET user_id=NULL,store_id=NULL,account_version=NULL,login_until=NULL,monitoring=false,audio_ready=false,connection_ok=false WHERE id=$1", id); e != nil {
		return e
	}
	return tx.Commit()
}

func (a *API) kitchenLogin(w http.ResponseWriter, r *http.Request, u Account, label string) {
	label = strings.TrimSpace(label)
	if label == "" {
		label = "Браузер кухни"
	}
	if utf8.RuneCountInString(label) > 100 {
		fail(w, problem(400, "Название устройства: до 100 символов."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	// Serialize against password changes and disabling the shared account.
	var version int64
	var active bool
	var archived bool
	e = tx.QueryRowContext(r.Context(), "SELECT a.version,a.active,s.archived FROM staff_accounts a JOIN stores s ON s.id=a.kitchen_store_id WHERE a.id=$1 FOR UPDATE OF a", u.ID).Scan(&version, &active, &archived)
	if e != nil {
		fail(w, e)
		return
	}
	if !active || version != u.Version || archived {
		reply(w, 401, map[string]string{"error": "Неверный логин или пароль."})
		return
	}
	secret := deviceSecret(r)
	var id int64
	var state, code string
	var until time.Time
	e = tx.QueryRowContext(r.Context(), "SELECT id,state,pairing_code,pending_until FROM kitchen_devices WHERE secret_hash=$1 FOR UPDATE", Hash(secret)).Scan(&id, &state, &code, &until)
	if e != nil && e != sql.ErrNoRows {
		fail(w, e)
		return
	}
	if state == "revoked" {
		reply(w, 403, map[string]string{"error": "Устройство отозвано владельцем.", "code": "device_revoked"})
		return
	}
	if e == sql.ErrNoRows {
		secret = randomToken()
		code = strings.ToUpper(randomToken()[:8])
		e = tx.QueryRowContext(r.Context(), "INSERT INTO kitchen_devices(secret_hash,label,pairing_code,user_id,store_id,account_version) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,pending_until", Hash(secret), label, code, u.ID, u.KitchenStoreID, u.Version).Scan(&id, &until)
		state = "pending"
	} else if state == "pending" {
		// A fresh password check can renew an expired enrollment, never an old poll.
		code = strings.ToUpper(randomToken()[:8])
		e = tx.QueryRowContext(r.Context(), "UPDATE kitchen_devices SET label=$2,pairing_code=$3,pending_until=now()+interval '10 minutes',user_id=$4,store_id=$5,account_version=$6 WHERE id=$1 RETURNING pending_until", id, label, code, u.ID, u.KitchenStoreID, u.Version).Scan(&until)
	}
	if e != nil {
		fail(w, e)
		return
	}
	if state == "pending" {
		if e = tx.Commit(); e != nil {
			fail(w, e)
			return
		}
		a.deviceCookie(w, secret)
		reply(w, 202, map[string]any{"approval_required": true, "pairing_code": code, "expires_at": until, "device_label": label})
		return
	}
	if e = a.bindKitchenDevice(r.Context(), tx, id, u); e != nil {
		fail(w, e)
		return
	}
	token, lifetime, e := a.issueKitchenSession(r.Context(), tx, id, u, time.Now().Add(kitchenRemember))
	if e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, e)
		return
	}
	a.deviceCookie(w, secret)
	a.cookie(w, token, lifetime)
	u.DeviceID = id
	u.DeviceLabel = label
	u.Memberships = []Membership{{u.KitchenStoreID, "worker"}}
	reply(w, 200, u)
}
func (a *API) bindKitchenDevice(ctx context.Context, tx *sql.Tx, id int64, u Account) error {
	if _, e := tx.ExecContext(ctx, "DELETE FROM sessions WHERE device_id=$1", id); e != nil {
		return e
	}
	if _, e := tx.ExecContext(ctx, "DELETE FROM kitchen_alert_tokens WHERE device_id=$1", id); e != nil {
		return e
	}
	if _, e := tx.ExecContext(ctx, "UPDATE kitchen_devices SET user_id=$2,store_id=$3,account_version=$4,login_until=now()+interval '30 days',monitoring=false,audio_ready=false,connection_ok=false,last_seen_at=NULL,last_queue_at=NULL WHERE id=$1", id, u.ID, u.KitchenStoreID, u.Version); e != nil {
		return e
	}
	_, e := tx.ExecContext(ctx, "UPDATE staff_accounts SET last_login_at=now() WHERE id=$1", u.ID)
	return e
}
func (a *API) issueKitchenSession(ctx context.Context, tx *sql.Tx, id int64, u Account, deadline time.Time) (string, int, error) {
	lifetime := 43200
	if remaining := int(time.Until(deadline).Seconds()); remaining < lifetime {
		lifetime = remaining
	}
	if lifetime <= 0 {
		return "", 0, problem(401, "Войдите в точку снова.")
	}
	token := randomToken()
	_, e := tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,expires_at,user_id,account_version,staff_name,device_id) VALUES($1,now()+($2*interval '1 second'),$3,$4,$5,$6)", Hash(token), lifetime, u.ID, u.Version, u.Username, id)
	return token, lifetime, e
}

// Both enrollment completion and silent renewal require the unguessable HttpOnly
// device credential. Approval alone cannot turn a revoked account into a session.
func (a *API) kitchenRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != a.Config.Origin {
		reply(w, 403, map[string]string{"error": "Недопустимый источник запроса."})
		return
	}
	secret := deviceSecret(r)
	if secret == "" {
		reply(w, 401, map[string]string{"error": "Войдите в точку."})
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var id, uid, version int64
	var state, code, label string
	var pending time.Time
	var deadline sql.NullTime
	e = tx.QueryRowContext(r.Context(), "SELECT id,COALESCE(user_id,0),COALESCE(account_version,0),state,pairing_code,label,pending_until,login_until FROM kitchen_devices WHERE secret_hash=$1", Hash(secret)).Scan(&id, &uid, &version, &state, &code, &label, &pending, &deadline)
	if e == sql.ErrNoRows || state == "revoked" {
		reply(w, 401, map[string]string{"error": "Доступ устройства завершён."})
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	allowed, err := a.Store.Allow(r.Context(), "device-refresh:"+a.Store.privacyDigest("device-refresh", secret), 360)
	if err != nil {
		fail(w, err)
		return
	}
	if !allowed {
		w.Header().Set("Retry-After", "600")
		reply(w, 429, map[string]string{"error": "Слишком много запросов устройства. Повторите позже."})
		return
	}
	if state == "pending" {
		if !time.Now().Before(pending) {
			reply(w, 410, map[string]string{"error": "Время подтверждения истекло. Введите логин и пароль снова."})
			return
		}
		reply(w, 202, map[string]any{"approval_required": true, "pairing_code": code, "expires_at": pending, "device_label": label})
		return
	}
	u, e := scanAccount(tx.QueryRowContext(r.Context(), "SELECT "+accountCols+" FROM staff_accounts WHERE id=$1 FOR UPDATE", uid))
	if e == sql.ErrNoRows {
		reply(w, 401, map[string]string{"error": "Войдите в точку."})
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	var boundUser, boundStore int64
	e = tx.QueryRowContext(r.Context(), "SELECT COALESCE(user_id,0),COALESCE(store_id,0),COALESCE(account_version,0),state,pending_until,login_until FROM kitchen_devices WHERE id=$1 FOR UPDATE", id).Scan(&boundUser, &boundStore, &version, &state, &pending, &deadline)
	if e != nil {
		fail(w, e)
		return
	}
	if state != "approved" || boundUser != u.ID || boundStore != u.KitchenStoreID {
		reply(w, 401, map[string]string{"error": "Точка устройства изменилась. Войдите снова."})
		return
	}
	if !u.Active || u.AccountType != "kitchen" || u.Version != version {
		reply(w, 401, map[string]string{"error": "Войдите в точку снова."})
		return
	}
	var archived bool
	if e = tx.QueryRowContext(r.Context(), "SELECT archived FROM stores WHERE id=$1", u.KitchenStoreID).Scan(&archived); e != nil {
		fail(w, e)
		return
	}
	if archived {
		reply(w, 403, map[string]string{"error": "Точка в архиве."})
		return
	}
	if !deadline.Valid {
		if !time.Now().Before(pending) {
			reply(w, 410, map[string]string{"error": "Повторите вход в точку."})
			return
		}
		if e = a.bindKitchenDevice(r.Context(), tx, id, u); e != nil {
			fail(w, e)
			return
		}
		deadline = sql.NullTime{Time: time.Now().Add(kitchenRemember), Valid: true}
	}
	if !time.Now().Before(deadline.Time) {
		reply(w, 401, map[string]string{"error": "Прошло 30 дней. Введите пароль точки снова."})
		return
	}
	// Parallel tabs can renew independently; they do not invalidate each other.
	token, lifetime, e := a.issueKitchenSession(r.Context(), tx, id, u, deadline.Time)
	if e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, e)
		return
	}
	a.deviceCookie(w, secret)
	a.cookie(w, token, lifetime)
	u.DeviceID = id
	u.DeviceLabel = label
	u.Memberships = []Membership{{u.KitchenStoreID, "worker"}}
	reply(w, 200, u)
}

type KitchenDevice struct {
	ID           int64      `json:"id"`
	Label        string     `json:"label"`
	State        string     `json:"state"`
	PairingCode  string     `json:"pairing_code,omitempty"`
	PendingUntil time.Time  `json:"pending_until"`
	StoreID      *int64     `json:"store_id"`
	LastSeen     *time.Time `json:"last_seen_at"`
	LoginUntil   *time.Time `json:"login_until"`
	AppVersion   string     `json:"app_version"`
	Monitoring   bool       `json:"monitoring"`
	AudioReady   bool       `json:"audio_ready"`
	Volume       int        `json:"volume"`
	ConnectionOK bool       `json:"connection_ok"`
	Online       bool       `json:"online"`
	Healthy      bool       `json:"healthy"`
}

func (a *API) kitchenAccess(w http.ResponseWriter, r *http.Request) {
	accounts := []Account{}
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT "+accountCols+" FROM staff_accounts WHERE account_type='kitchen' ORDER BY kitchen_store_id,active DESC,id")
	if e != nil {
		fail(w, e)
		return
	}
	for rows.Next() {
		u, e := scanAccount(rows)
		if e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		u.Memberships = []Membership{{u.KitchenStoreID, "worker"}}
		accounts = append(accounts, u)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	rows, e = a.Store.DB.QueryContext(r.Context(), "SELECT id,label,state,CASE WHEN state='pending' AND pending_until>now() THEN pairing_code ELSE '' END,pending_until,store_id,last_seen_at,login_until,app_version,monitoring,audio_ready,volume,connection_ok,COALESCE(state='approved' AND login_until>now() AND last_seen_at>now()-interval '60 seconds' AND EXISTS(SELECT 1 FROM staff_accounts a WHERE a.id=user_id AND a.active AND a.version=account_version),false) FROM kitchen_devices WHERE state<>'pending' OR pending_until>now() ORDER BY created_at DESC LIMIT 500")
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	devices := []KitchenDevice{}
	for rows.Next() {
		var d KitchenDevice
		if e = rows.Scan(&d.ID, &d.Label, &d.State, &d.PairingCode, &d.PendingUntil, &d.StoreID, &d.LastSeen, &d.LoginUntil, &d.AppVersion, &d.Monitoring, &d.AudioReady, &d.Volume, &d.ConnectionOK, &d.Online); e != nil {
			fail(w, e)
			return
		}
		d.Healthy = d.Online && d.Monitoring && d.AudioReady && d.Volume > 0 && d.ConnectionOK
		devices = append(devices, d)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]any{"accounts": accounts, "devices": devices, "server_time": time.Now().UTC()})
}
func (a *API) saveKitchenAccess(w http.ResponseWriter, r *http.Request) {
	sid, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || sid < 1 {
		fail(w, ErrMissing)
		return
	}
	var in struct {
		Username    string `json:"username"`
		Active      bool   `json:"active"`
		Rotate      bool   `json:"rotate_password"`
		EndSessions bool   `json:"end_sessions"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Username = NormalizeUsername(in.Username)
	if !usernamePattern.MatchString(in.Username) {
		fail(w, problem(400, "Логин: 3–60 латинских символов, цифры, точка, дефис или подчёркивание."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(r.Context(), "SELECT pg_advisory_xact_lock(184015)"); e != nil {
		fail(w, e)
		return
	}
	var address string
	e = tx.QueryRowContext(r.Context(), "SELECT address FROM settings JOIN stores ON stores.id=settings.id WHERE settings.id=$1 AND NOT stores.archived", sid).Scan(&address)
	if e == sql.ErrNoRows {
		fail(w, ErrMissing)
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	var id int64
	e = tx.QueryRowContext(r.Context(), "SELECT id FROM staff_accounts WHERE account_type='kitchen' AND kitchen_store_id=$1 ORDER BY active DESC,id DESC LIMIT 1 FOR UPDATE", sid).Scan(&id)
	if e != nil && e != sql.ErrNoRows {
		fail(w, e)
		return
	}
	var duplicate bool
	if e = tx.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM staff_accounts WHERE username=$1 AND id<>$2)", in.Username, id).Scan(&duplicate); e != nil {
		fail(w, e)
		return
	}
	if duplicate {
		fail(w, problem(409, "Этот логин уже используется."))
		return
	}
	password := ""
	hash := ""
	if id == 0 || in.Rotate {
		password = randomToken()[:24]
		hash, e = PasswordHash(password)
		if e != nil {
			fail(w, e)
			return
		}
	}
	if id == 0 {
		e = tx.QueryRowContext(r.Context(), "INSERT INTO staff_accounts(username,display_name,active,password_hash,account_type,kitchen_store_id) VALUES($1,$2,$3,$4,'kitchen',$5) RETURNING id", in.Username, "Кухня · "+address, in.Active, hash, sid).Scan(&id)
	} else {
		_, e = tx.ExecContext(r.Context(), "UPDATE staff_accounts SET username=$2,active=$3,version=version+1,password_hash=CASE WHEN $4='' THEN password_hash ELSE $4 END WHERE id=$1", id, in.Username, in.Active, hash)
	}
	if e != nil {
		fail(w, e)
		return
	}
	if _, e = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
		fail(w, e)
		return
	}
	if _, e = tx.ExecContext(r.Context(), "DELETE FROM kitchen_alert_tokens WHERE user_id=$1", id); e != nil {
		fail(w, e)
		return
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE kitchen_devices SET login_until=NULL,monitoring=false,audio_ready=false,connection_ok=false WHERE user_id=$1", id); e != nil {
		fail(w, e)
		return
	}
	if e = auditDetails(shopContext(r.Context(), sid), tx, "kitchen.access", fmt.Sprint(id), mustJSON(map[string]any{"active": in.Active, "password_rotated": in.Rotate || password != "", "sessions_ended": true})); e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, e)
		return
	}
	u, e := a.Store.account(r.Context(), id)
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]any{"account": u, "password": password})
}
func (a *API) kitchenDeviceAction(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || id < 1 {
		fail(w, ErrMissing)
		return
	}
	var in struct {
		Action string `json:"action"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Action != "approve" && in.Action != "revoke" {
		fail(w, problem(400, "Неизвестное действие."))
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var result sql.Result
	if in.Action == "approve" {
		result, e = tx.ExecContext(r.Context(), "UPDATE kitchen_devices SET state='approved',approved_at=now() WHERE id=$1 AND state='pending' AND pending_until>now()", id)
	} else {
		result, e = tx.ExecContext(r.Context(), "UPDATE kitchen_devices SET state='revoked',login_until=NULL,monitoring=false,audio_ready=false,connection_ok=false WHERE id=$1", id)
	}
	if e != nil {
		fail(w, e)
		return
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		fail(w, problem(409, "Заявка истекла или состояние устройства изменилось."))
		return
	}
	if in.Action == "revoke" {
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE device_id=$1", id); e != nil {
			fail(w, e)
			return
		}
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM kitchen_alert_tokens WHERE device_id=$1", id); e != nil {
			fail(w, e)
			return
		}
	}
	if e = audit(r.Context(), tx, "kitchen.device."+in.Action, fmt.Sprint(id)); e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]bool{"saved": true})
}

func (a *API) nativeKitchenToken(w http.ResponseWriter, r *http.Request) {
	u := actor(r.Context())
	if u.AccountType != "kitchen" || u.DeviceID == 0 {
		reply(w, 403, map[string]string{"error": "Нужен общий вход точки на подтверждённом устройстве."})
		return
	}
	token := randomToken()
	var until time.Time
	e := a.Store.DB.QueryRowContext(r.Context(), "INSERT INTO kitchen_alert_tokens(device_id,token_hash,user_id,store_id,account_version,expires_at) SELECT d.id,$2,d.user_id,d.store_id,d.account_version,d.login_until FROM kitchen_devices d JOIN staff_accounts a ON a.id=d.user_id WHERE d.id=$1 AND d.state='approved' AND d.login_until>now() AND d.account_version=$3 AND d.user_id=$4 AND d.store_id=$5 AND a.active AND a.version=$3 ON CONFLICT(device_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,user_id=EXCLUDED.user_id,store_id=EXCLUDED.store_id,account_version=EXCLUDED.account_version,expires_at=EXCLUDED.expires_at RETURNING expires_at", u.DeviceID, Hash(token), u.Version, u.ID, u.KitchenStoreID).Scan(&until)
	if e == sql.ErrNoRows {
		reply(w, 401, map[string]string{"error": "Доступ устройства изменился. Повторите вход."})
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]any{"token": token, "store_id": u.KitchenStoreID, "device_id": u.DeviceID, "expires_at": until})
}
func (a *API) nativeKitchen(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(token) != 43 {
			reply(w, 401, map[string]string{"error": "Доступ устройства завершён."})
			return
		}
		var uid, sid, did int64
		e := a.Store.DB.QueryRowContext(r.Context(), "SELECT t.user_id,t.store_id,t.device_id FROM kitchen_alert_tokens t JOIN kitchen_devices d ON d.id=t.device_id JOIN staff_accounts a ON a.id=t.user_id JOIN stores s ON s.id=t.store_id WHERE t.token_hash=$1 AND t.expires_at>now() AND d.state='approved' AND d.user_id=t.user_id AND d.store_id=t.store_id AND d.account_version=t.account_version AND d.login_until>now() AND a.active AND a.account_type='kitchen' AND a.version=t.account_version AND a.kitchen_store_id=t.store_id AND NOT s.archived", Hash(token)).Scan(&uid, &sid, &did)
		if e == sql.ErrNoRows {
			reply(w, 401, map[string]string{"error": "Доступ устройства завершён."})
			return
		}
		if e != nil {
			fail(w, e)
			return
		}
		u := Account{ID: uid, DeviceID: did, KitchenStoreID: sid, AccountType: "kitchen"}
		next(w, r.WithContext(shopContext(context.WithValue(r.Context(), accountKey{}, u), sid)))
	}
}
func (a *API) kitchenAlertState(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT id,number FROM orders WHERE store_id=$1 AND status='new' ORDER BY created_at,id", shopID(r.Context()))
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	type pendingOrder struct {
		ID     int64 `json:"id"`
		Number int64 `json:"number"`
	}
	orders := []pendingOrder{}
	for rows.Next() {
		var o pendingOrder
		if e = rows.Scan(&o.ID, &o.Number); e != nil {
			fail(w, e)
			return
		}
		orders = append(orders, o)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, map[string]any{"orders": orders, "store_id": shopID(r.Context()), "server_time": time.Now().UTC()})
}
func (a *API) kitchenHeartbeat(w http.ResponseWriter, r *http.Request) {
	u := actor(r.Context())
	if u.DeviceID == 0 {
		reply(w, 403, map[string]string{"error": "Устройство не подтверждено."})
		return
	}
	var in struct {
		Monitoring   bool   `json:"monitoring"`
		AudioReady   bool   `json:"audio_ready"`
		Volume       int    `json:"volume"`
		ConnectionOK bool   `json:"connection_ok"`
		AppVersion   string `json:"app_version"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Volume < 0 || in.Volume > 100 || len(in.AppVersion) > 50 {
		fail(w, problem(400, "Некорректное состояние устройства."))
		return
	}
	result, e := a.Store.DB.ExecContext(r.Context(), "UPDATE kitchen_devices SET last_seen_at=now(),monitoring=$2,audio_ready=$3,volume=$4,connection_ok=$5,app_version=$6,last_queue_at=CASE WHEN $5 THEN now() ELSE last_queue_at END WHERE id=$1 AND state='approved' AND user_id=$7 AND login_until>now() AND store_id=$8", u.DeviceID, in.Monitoring, in.AudioReady, in.Volume, in.ConnectionOK, in.AppVersion, u.ID, u.KitchenStoreID)
	if e != nil {
		fail(w, e)
		return
	}
	if n, _ := result.RowsAffected(); n != 1 {
		reply(w, 401, map[string]string{"error": "Доступ устройства завершён."})
		return
	}
	reply(w, 200, map[string]bool{"saved": true})
}
