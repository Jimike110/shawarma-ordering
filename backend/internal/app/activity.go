package app

import (
	"database/sql"

	"encoding/json"

	"context"
)

type staffContextKey struct{}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func audit(ctx context.Context, tx *sql.Tx, action, resource string) error {
	return auditDetails(ctx, tx, action, resource, []byte("{}"))
}

func auditDetails(ctx context.Context, tx *sql.Tx, action, resource string, details []byte) error {
	u := actor(ctx)
	name, _ := ctx.Value(staffContextKey{}).(string)
	if name == "" {
		name = "system"
	}
	var aid, sid, did any
	if u.DeviceID > 0 {
		did = u.DeviceID
	}
	if u.ID > 0 {
		aid = u.ID
	}
	if id, ok := ctx.Value(storeKey{}).(int64); ok {
		sid = id
	}
	_, e := tx.ExecContext(ctx, "INSERT INTO audit_events(staff_name,actor_id,store_id,action,resource,details,device_id) VALUES($1,$2,$3,$4,$5,$6,$7)", name, aid, sid, action, resource, details, did)
	return e
}
