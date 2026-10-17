package app

import (
	"time"

	"encoding/json"
	"net/http"
	"strconv"
)

type Activity struct {
	DeviceID    *int64          `json:"device_id,omitempty"`
	DeviceLabel string          `json:"device_label,omitempty"`
	ID          int64           `json:"id"`
	Actor       string          `json:"actor"`
	StoreID     *int64          `json:"store_id"`
	Action      string          `json:"action"`
	Resource    string          `json:"resource"`
	Details     json.RawMessage `json:"details"`
	At          time.Time       `json:"created_at"`
}

// Only owner endpoints accept a reporting filter. Scoped requests keep the
// already-authorized context, even when a caller supplies a forged query value.
func (a *API) reportStore(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if id, scoped := r.Context().Value(storeKey{}).(int64); scoped && id != 0 {
		return id, true
	}
	value := r.URL.Query().Get("store_id")
	if value == "" {
		return 0, true
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id < 1 {
		fail(w, problem(400, "Проверьте точку."))
		return 0, false
	}
	var exists bool
	if err = a.Store.DB.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM stores WHERE id=$1)", id).Scan(&exists); err != nil {
		fail(w, err)
		return 0, false
	}
	if !exists {
		fail(w, ErrMissing)
		return 0, false
	}
	return id, true
}

func (a *API) activity(w http.ResponseWriter, r *http.Request) {
	id, ok := a.reportStore(w, r)
	if !ok {
		return
	}
	before := int64(0)
	if v := r.URL.Query().Get("before"); v != "" {
		var e error
		before, e = strconv.ParseInt(v, 10, 64)
		if e != nil || before < 1 {
			fail(w, problem(400, "Некорректная страница."))
			return
		}
	}
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT id,staff_name,store_id,action,resource,details,created_at,device_id,COALESCE((SELECT label FROM kitchen_devices WHERE id=audit_events.device_id),'') FROM audit_events WHERE ($1::bigint=0 OR store_id=$1) AND ($2::bigint=0 OR id<$2) ORDER BY id DESC LIMIT 100", id, before)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var v Activity
		if e = rows.Scan(&v.ID, &v.Actor, &v.StoreID, &v.Action, &v.Resource, &v.Details, &v.At, &v.DeviceID, &v.DeviceLabel); e != nil {
			fail(w, e)
			return
		}
		out = append(out, v)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, out)
}
