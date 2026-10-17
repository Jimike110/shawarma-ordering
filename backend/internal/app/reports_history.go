package app

import (
	"net/http"
	"strconv"
)

func (a *API) orderHistory(w http.ResponseWriter, r *http.Request) {
	id, ok := a.reportStore(w, r)
	if !ok {
		return
	}
	before := int64(0)
	if value := r.URL.Query().Get("before"); value != "" {
		var e error
		before, e = strconv.ParseInt(value, 10, 64)
		if e != nil || before < 1 {
			fail(w, problem(400, "Некорректная страница."))
			return
		}
	}
	status := r.URL.Query().Get("status")
	if status != "" && status != "new" && status != "preparing" && status != "ready" && status != "completed" && status != "cancelled" {
		fail(w, problem(400, "Некорректный статус."))
		return
	}
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT "+orderCols+" FROM orders WHERE ($1::bigint=0 OR store_id=$1) AND ($2::bigint=0 OR id<$2) AND ($3='' OR status=$3) ORDER BY id DESC LIMIT 100", id, before, status)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		o, e := scanOrder(rows)
		if e != nil {
			fail(w, e)
			return
		}
		out = append(out, o)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, out)
}
