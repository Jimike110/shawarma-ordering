package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestProductDeletionPermissionsAndReceipts(t *testing.T) {
	s, a, owner := accessFixture(t)
	second := fixtureShop(t, a, owner)
	fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, false)
	fixtureAccount(t, s, "manager", []Membership{{1, "manager"}, {second.ID, "worker"}}, false)
	worker := loginAccount(t, a, "worker", testPassword)
	manager := loginAccount(t, a, "manager", testPassword)
	ctx := context.Background()
	other, e := s.SaveProduct(shopContext(ctx, second.ID), Product{Name: "Other store", Price: 300, Image: "/images/classic.jpg", Available: true})
	if e != nil {
		t.Fatal(e)
	}
	for _, tc := range []struct {
		path   string
		cookie *http.Cookie
		origin string
		status int
	}{
		{"/api/staff/stores/1/products/1", nil, a.Config.Origin, 401},
		{"/api/staff/stores/1/products/1", owner, "https://untrusted.invalid", 403},
		{"/api/staff/stores/1/products/1", worker, a.Config.Origin, 403},
		{"/api/kitchen/products/1", worker, a.Config.Origin, 403},
		{fmt.Sprintf("/api/staff/stores/%d/products/%d", second.ID, other.ID), worker, a.Config.Origin, 403},
		{fmt.Sprintf("/api/staff/stores/%d/products/%d", second.ID, other.ID), manager, a.Config.Origin, 403},
		{fmt.Sprintf("/api/staff/stores/1/products/%d", other.ID), manager, a.Config.Origin, 404},
		{fmt.Sprintf("/api/kitchen/products/%d", other.ID), owner, a.Config.Origin, 404},
		{"/api/staff/stores/1/products/invalid", owner, a.Config.Origin, 404},
	} {
		t.Run(tc.path+fmt.Sprint(tc.status), func(t *testing.T) {
			mustStatus(t, call(t, a, "DELETE", tc.path, nil, tc.cookie, tc.origin), tc.status)
		})
	}
	c := checkout()
	before, e := s.CreateOrder(ctx, c, a.orderToken(c.RequestKey))
	if e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "DELETE", "/api/staff/stores/1/products/1", nil, owner, a.Config.Origin), 200)
	mustStatus(t, call(t, a, "DELETE", "/api/staff/stores/1/products/1", nil, owner, a.Config.Origin), 404)
	products, e := s.Products(ctx)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range products {
		if p.ID == 1 {
			t.Fatal("deleted product still in menu")
		}
	}
	// Accepted retries still resolve before checking the current menu.
	after, e := s.CreateOrder(ctx, c, a.orderToken(c.RequestKey))
	if e != nil || before.ID != after.ID || before.Number != after.Number || before.Total != after.Total || !reflect.DeepEqual(before.Items, after.Items) {
		t.Fatalf("deletion changed an accepted order: %v", e)
	}
	tracked := call(t, a, "GET", "/api/orders/"+a.orderToken(c.RequestKey), nil, nil, "")
	mustStatus(t, tracked, 200)
	var receipt Order
	if e = json.Unmarshal(tracked.Body.Bytes(), &receipt); e != nil {
		t.Fatal(e)
	}
	if receipt.Total != before.Total || !reflect.DeepEqual(receipt.Items, before.Items) {
		t.Fatal("private receipt lost its item snapshots")
	}
	c.RequestKey = strings.Repeat("d", 36)
	mustStatus(t, call(t, a, "POST", "/api/orders", c, nil, a.Config.Origin), 409)
	mustStatus(t, call(t, a, "PATCH", "/api/staff/stores/1/products/1/availability", map[string]bool{"available": true}, owner, a.Config.Origin), 404)
	var actorID, storeID int64
	var action, name string
	if e = s.DB.QueryRow("SELECT actor_id,store_id,action,details->>'name' FROM audit_events WHERE action='product.delete' AND resource='1'").Scan(&actorID, &storeID, &action, &name); e != nil {
		t.Fatal(e)
	}
	if actorID == 0 || storeID != 1 || name != before.Items[0].Name {
		t.Fatal("deletion audit lacks the actor, store or item name")
	}
	// Assigned managers may remove products through the legacy alias too.
	mustStatus(t, call(t, a, "DELETE", "/api/kitchen/products/2", nil, manager, a.Config.Origin), 200)
	var count int
	if e = s.DB.QueryRow("SELECT count(*) FROM products WHERE id=$1 AND store_id=$2", other.ID, second.ID).Scan(&count); e != nil || count != 1 {
		t.Fatalf("another store's product was affected: %v", e)
	}
	if _, e = s.DB.Exec("UPDATE stores SET archived=true WHERE id=$1", second.ID); e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "DELETE", fmt.Sprintf("/api/staff/stores/%d/products/%d", second.ID, other.ID), nil, owner, a.Config.Origin), 403)
}

func TestProductDeletionRollsBackWithoutAudit(t *testing.T) {
	s, a, owner := accessFixture(t)
	if _, e := s.DB.Exec("ALTER TABLE audit_events ADD CONSTRAINT reject_delete_audit CHECK (action <> 'product.delete')"); e != nil {
		t.Fatal(e)
	}
	mustStatus(t, call(t, a, "DELETE", "/api/staff/stores/1/products/1", nil, owner, a.Config.Origin), 500)
	var count int
	if e := s.DB.QueryRow("SELECT count(*) FROM products WHERE id=1 AND store_id=1").Scan(&count); e != nil || count != 1 {
		t.Fatalf("product deletion committed without its audit: %v", e)
	}
}
