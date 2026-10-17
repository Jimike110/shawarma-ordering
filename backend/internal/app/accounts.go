package app

import (
	"time"

	"context"
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
	AccountType      string       `json:"account_type"`
	KitchenStoreID   int64        `json:"kitchen_store_id,omitempty"`
	DeviceID         int64        `json:"device_id,omitempty"`
	DeviceLabel      string       `json:"device_label,omitempty"`
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
	if u.AccountType == "kitchen" {
		if u.KitchenStoreID == id {
			return "worker"
		}
		return ""
	}
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
