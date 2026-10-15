package app

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type PrivacyRequest struct {
	ID           int64      `json:"id"`
	OrderID      *int64     `json:"order_id"`
	OrderNumber  *int64     `json:"order_number"`
	Kind         string     `json:"kind"`
	Status       string     `json:"status"`
	Verification string     `json:"verification"`
	CreatedAt    time.Time  `json:"created_at"`
	VerifiedAt   *time.Time `json:"verified_at"`
	ResolvedAt   *time.Time `json:"resolved_at"`
}

func (a *API) privacyRequests(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		var in struct {
			OrderID     int64  `json:"order_id"`
			OrderNumber int64  `json:"order_number"`
			StoreID     int64  `json:"store_id"`
			Kind        string `json:"kind"`
		}
		if !decode(w, r, &in) {
			return
		}
		if in.StoreID < 1 || (in.OrderID > 0) == (in.OrderNumber > 0) {
			fail(w, problem(400, "Выберите точку и укажите номер заказа."))
			return
		}
		if in.Kind != "access" && in.Kind != "correction" && in.Kind != "withdrawal" && in.Kind != "erasure" && in.Kind != "dispute" {
			fail(w, problem(400, "Выберите вид обращения."))
			return
		}
		var id int64
		e := a.Store.DB.QueryRowContext(r.Context(), `INSERT INTO privacy_requests(order_id,kind,actor_id) SELECT id,$3,$4 FROM orders WHERE store_id=$2 AND (($1::bigint>0 AND id=$1) OR ($5::bigint>0 AND number=$5)) RETURNING id`, in.OrderID, in.StoreID, in.Kind, actor(r.Context()).ID, in.OrderNumber).Scan(&id)
		if e == sql.ErrNoRows {
			fail(w, ErrMissing)
			return
		}
		if e != nil {
			fail(w, e)
			return
		}
		reply(w, 201, map[string]int64{"id": id})
		return
	}
	before := int64(0)
	if value := r.URL.Query().Get("before"); value != "" {
		var err error
		before, err = strconv.ParseInt(value, 10, 64)
		if err != nil || before < 1 {
			fail(w, problem(400, "Некорректная страница обращений."))
			return
		}
	}
	rows, e := a.Store.DB.QueryContext(r.Context(), "SELECT r.id,r.order_id,o.number,r.kind,r.status,r.verification,r.created_at,r.verified_at,r.resolved_at FROM privacy_requests r LEFT JOIN orders o ON o.id=r.order_id WHERE ($1::bigint=0 OR r.id<$1) ORDER BY r.id DESC LIMIT 200", before)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	out := []PrivacyRequest{}
	for rows.Next() {
		var p PrivacyRequest
		if e = rows.Scan(&p.ID, &p.OrderID, &p.OrderNumber, &p.Kind, &p.Status, &p.Verification, &p.CreatedAt, &p.VerifiedAt, &p.ResolvedAt); e != nil {
			fail(w, e)
			return
		}
		out = append(out, p)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, out)
}
func (a *API) privacyRequestAction(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var in struct {
		Action       string `json:"action"`
		Verification string `json:"verification"`
		Name         string `json:"name"`
		Note         string `json:"note"`
	}
	if !decode(w, r, &in) {
		return
	}
	ctx := r.Context()
	tx, e := a.Store.DB.BeginTx(ctx, nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184020)"); e != nil {
		fail(w, e)
		return
	}
	var orderID sql.NullInt64
	var status, kind string
	e = tx.QueryRowContext(ctx, "SELECT order_id,status,kind FROM privacy_requests WHERE id=$1 FOR UPDATE", id).Scan(&orderID, &status, &kind)
	if e == sql.ErrNoRows {
		fail(w, ErrMissing)
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	if status == "resolved" {
		fail(w, problem(409, "Обращение уже завершено."))
		return
	}
	var exported any
	if in.Action == "verify" {
		if in.Verification != "personal_link_and_purchase" && in.Verification != "in_person" && in.Verification != "existing_contact" {
			fail(w, problem(400, "Подтвердите соразмерный способ проверки принадлежности данных."))
			return
		}
		_, e = tx.ExecContext(ctx, "UPDATE privacy_requests SET status='verified',verification=$1,verified_at=now() WHERE id=$2", in.Verification, id)
	} else {
		if status != "verified" {
			fail(w, problem(409, "Сначала проверьте принадлежность данных человеку."))
			return
		}
		if in.Action == "resolve" {
			_, e = tx.ExecContext(ctx, "UPDATE privacy_requests SET status='resolved',resolved_at=now() WHERE id=$1", id)
		} else {
			if !orderID.Valid {
				fail(w, problem(410, "Квитанция уже удалена по сроку хранения."))
				return
			}
			var exists int64
			if e = tx.QueryRowContext(ctx, "SELECT id FROM orders WHERE id=$1 FOR UPDATE", orderID.Int64).Scan(&exists); e != nil {
				fail(w, e)
				return
			}
			switch in.Action {
			case "export":
				o, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderCols+" FROM orders WHERE id=$1", orderID.Int64))
				e = err
				if e == nil {
					var name, note, state string
					var blocked bool
					var erased *time.Time
					var notice *int64
					var closed *time.Time
					var reason string
					e = tx.QueryRowContext(ctx, "SELECT customer_name,note,personal_blocked,personal_erased_at,consent_state,notice_version,closed_at,cancellation_reason FROM orders WHERE id=$1", orderID.Int64).Scan(&name, &note, &blocked, &erased, &state, &notice, &closed, &reason)
					o.CancelledBy = ""
					proof := []map[string]any{}
					if e == nil {
						rows, err := tx.QueryContext(ctx, "SELECT purpose,version_id,accepted,recorded_at FROM privacy_evidence WHERE order_ref=$1 ORDER BY id", orderID.Int64)
						e = err
						if e == nil {
							for rows.Next() {
								var purpose string
								var version int64
								var accepted bool
								var at time.Time
								if e = rows.Scan(&purpose, &version, &accepted, &at); e != nil {
									break
								}
								proof = append(proof, map[string]any{"purpose": purpose, "version": version, "accepted": accepted, "recorded_at": at})
							}
							if e == nil {
								e = rows.Err()
							}
							rows.Close()
						}
					}
					exported = map[string]any{"order": o, "name": name, "note": note, "blocked": blocked, "erased_at": erased, "consent_state": state, "notice_version": notice, "closed_at": closed, "cancellation_reason": reason, "consent_evidence": proof, "request_id": id}
				}
			case "block", "erase", "correct":
				if in.Action == "correct" {
					in.Name = strings.TrimSpace(in.Name)
					in.Note = strings.TrimSpace(in.Note)
					if utf8.RuneCountInString(in.Name) > 60 || utf8.RuneCountInString(in.Note) > 500 {
						fail(w, problem(400, "Имя — до 60 символов, комментарий — до 500."))
						return
					}
					var allowed bool
					e = tx.QueryRowContext(ctx, "SELECT consent_state='accepted' AND personal_erased_at IS NULL AND (closed_at IS NULL OR closed_at>now()-interval '7 days') FROM orders WHERE id=$1", orderID.Int64).Scan(&allowed)
					if e != nil {
						fail(w, e)
						return
					}
					if !allowed {
						fail(w, problem(409, "Нет действующего основания для восстановления необязательных полей."))
						return
					}
				}
				op := "erase"
				if in.Action == "block" {
					op = "block"
				}
				var entry deletionEntry
				entry, e = a.Store.journalEntry(ctx, tx, "order", orderID.Int64, op, "verified_request")
				if e == nil {
					switch in.Action {
					case "block":
						_, e = tx.ExecContext(ctx, "UPDATE orders SET personal_blocked=true WHERE id=$1", orderID.Int64)
					case "erase":
						e = erasePersonal(ctx, tx, orderID.Int64)
					case "correct":
						_, e = tx.ExecContext(ctx, "UPDATE orders SET customer_name=$1,note=$2,personal_blocked=false WHERE id=$3", in.Name, in.Note, orderID.Int64)
					}
				}
				if e == nil {
					_, e = tx.ExecContext(ctx, "UPDATE audit_events SET details='{}' WHERE action='order.update' AND resource=$1", fmt.Sprint(orderID.Int64))
				}
				if e == nil {
					e = recordDestruction(ctx, tx, entry)
				}
			default:
				fail(w, problem(400, "Неизвестное действие обращения."))
				return
			}
		}
	}
	if e == nil {
		e = audit(ctx, tx, "privacy.request."+in.Action, fmt.Sprint(id))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	if exported != nil {
		w.Header().Set("Content-Disposition", "attachment; filename=privacy-export.json")
		reply(w, 200, exported)
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}
