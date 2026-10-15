package app

import (
	"net/http"
	"strings"
	"time"
)

// Paginated log extract. The operator completes and signs the separate destruction act;
// this export does not attest physical erasure from still-restricted backup copies.
func (a *API) privacyDestructions(w http.ResponseWriter, r *http.Request) {
	after := r.URL.Query().Get("after")
	if after != "" && (len(after) != 32 || strings.Trim(after, "0123456789abcdef") != "") {
		fail(w, problem(400, "Некорректная страница журнала."))
		return
	}
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT event_id,target_kind,target_id,operation,categories,reason,executed_at,actor_id FROM privacy_destructions WHERE event_id>$1 AND operation<>'block' ORDER BY event_id LIMIT 1000", after)
	if e != nil {
		fail(w, e)
		return
	}
	out := []map[string]any{}
	next := ""
	for rows.Next() {
		var id, kind, op, categories, reason string
		var target int64
		var at time.Time
		var actorID *int64
		if e = rows.Scan(&id, &kind, &target, &op, &categories, &reason, &at, &actorID); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		out = append(out, map[string]any{"event_id": id, "subject_category": kind, "subject_reference": target, "operation": op, "categories": categories, "reason": reason, "executed_at": at, "actor_reference": actorID, "system": "Сервис предзаказа", "method": "Логическое удаление или замена полей PostgreSQL; копии закрыты до истечения"})
		next = id
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	state, e := a.Store.Privacy(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	var operator any
	if state.Current != nil {
		operator = state.Current.Operator
	}
	if len(out) < 1000 {
		next = ""
	}
	reply(w, 200, map[string]any{"operator": operator, "items": out, "next_after": next, "act_instructions": "Оформите отдельный акт: реквизиты оператора и обработчика, категории и ссылки на субъектов, категории данных, система, способ, основание и дата уничтожения; ФИО, должности и подписи ответственных. Проверьте комплектность по приказу РКН №179. Акт и выгрузку хранить три года. Не включайте удалённые значения. Закрытые резервные копии истекают отдельно, не позже 14 дней."})
}
