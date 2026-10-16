package app

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func toppingFixture(t *testing.T, s *Store) Topping {
	t.Helper()
	tx, e := s.DB.BeginTx(context.Background(), nil)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	_, e = tx.Exec("SELECT id FROM stores WHERE id=1 FOR UPDATE")
	if e != nil {
		t.Fatal(e)
	}
	out, e := saveToppingTx(context.Background(), tx, Topping{Name: "Fixture sauce", Image: "/images/classic.jpg", Available: true, ExtraPrice: 30, ExtraPortion: "20 г", StandalonePrice: 50, StandalonePortion: "40 г", ProductIDs: []int64{1}}, 1)
	if e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(); e != nil {
		t.Fatal(e)
	}
	return out
}
func TestToppingPricingAvailabilityRetryAndSnapshots(t *testing.T) {
	s, a, owner := accessFixture(t)
	top := toppingFixture(t, s)
	ctx := context.Background()
	products, e := s.Products(ctx)
	if e != nil {
		t.Fatal(e)
	}
	var dish Product
	for _, p := range products {
		if p.ID == 1 {
			dish = p
		}
	}
	if len(dish.Options) != 1 || dish.Options[0].ToppingID != top.ID || dish.Options[0].Available == nil || !*dish.Options[0].Available {
		t.Fatal("canonical extra missing")
	}
	c := checkout()
	c.Items[0].Options = []string{dish.Options[0].ID}
	c.Items[0].ExpectedPrice = 320
	c.Items = append(c.Items, CartItem{ProductID: top.StandaloneProductID, Quantity: 3, ExpectedPrice: 50})
	accepted, e := s.CreateOrder(ctx, c, a.orderToken(c.RequestKey))
	if e != nil {
		t.Fatal(e)
	}
	if accepted.Total != 790 || accepted.Items[0].Quantity != 2 || accepted.Items[0].Options[0].Portion != "20 г" || accepted.Items[1].Portion != "40 г" {
		t.Fatalf("wrong topping multiplication/snapshot: %+v", accepted)
	}
	// Both availability controls share the same canonical state.
	mustStatus(t, call(t, a, "PATCH", fmt.Sprintf("/api/staff/stores/1/products/%d/availability", top.StandaloneProductID), map[string]bool{"available": false}, owner, a.Config.Origin), 200)
	replay, e := s.CreateOrder(ctx, c, a.orderToken(c.RequestKey))
	if e != nil || !reflect.DeepEqual(replay.Items, accepted.Items) {
		t.Fatal("accepted retry changed", e)
	}
	c.RequestKey = strings.Repeat("n", 36)
	if _, e = s.CreateOrder(ctx, c, a.orderToken(c.RequestKey)); e == nil {
		t.Fatal("unavailable topping accepted")
	}
	mustStatus(t, call(t, a, "DELETE", fmt.Sprintf("/api/staff/stores/1/products/%d", top.StandaloneProductID), nil, owner, a.Config.Origin), 200)
	original, e := s.Track(ctx, a.orderToken(strings.Repeat("a", 36)))
	if e != nil || !reflect.DeepEqual(original.Items, accepted.Items) {
		t.Fatal("historical toppings changed", e)
	}
	products, _ = s.Products(ctx)
	for _, p := range products {
		for _, o := range p.Options {
			if o.ToppingID == top.ID {
				t.Fatal("deleted topping remained attached")
			}
		}
	}
}
func TestToppingAuthorizationAndCopyRelationships(t *testing.T) {
	s, a, owner := accessFixture(t)
	top := toppingFixture(t, s)
	second := fixtureShop(t, a, owner)
	fixtureAccount(t, s, "worker", []Membership{{1, "worker"}}, false)
	worker := loginAccount(t, a, "worker", testPassword)
	mustStatus(t, call(t, a, "PUT", fmt.Sprintf("/api/staff/stores/1/toppings/%d", top.ID), top, worker, a.Config.Origin), 403)
	path := fmt.Sprintf("/api/staff/stores/1/toppings/%d/availability", top.ID)
	mustStatus(t, call(t, a, "PATCH", path, map[string]any{"available": false, "extra_price": 1}, worker, a.Config.Origin), 400)
	mustStatus(t, call(t, a, "PATCH", fmt.Sprintf("/api/staff/stores/%d/toppings/%d/availability", second.ID, top.ID), map[string]bool{"available": false}, owner, a.Config.Origin), 404)
	top.ProductIDs = []int64{99999}
	mustStatus(t, call(t, a, "PUT", fmt.Sprintf("/api/staff/stores/1/toppings/%d", top.ID), top, owner, a.Config.Origin), 400)
	copy := map[string]any{"source_store_id": 1, "destination_store_id": second.ID, "product_ids": []int64{1}, "request_key": strings.Repeat("t", 36)}
	rr := call(t, a, "POST", "/api/owner/menu-copy", copy, owner, a.Config.Origin)
	mustStatus(t, rr, 200)
	again := call(t, a, "POST", "/api/owner/menu-copy", copy, owner, a.Config.Origin)
	mustStatus(t, again, 200)
	var replay []Product
	if e := json.Unmarshal(again.Body.Bytes(), &replay); e != nil {
		t.Fatal(e)
	}
	var copied []Product
	if e := json.Unmarshal(rr.Body.Bytes(), &copied); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(copied, replay) {
		t.Fatal("copy retry changed result")
	}
	if len(copied) != 2 || len(copied[0].Options) != 1 || copied[0].Options[0].ToppingID == top.ID || copied[0].Options[0].Available == nil || *copied[0].Options[0].Available || copied[1].Available || copied[1].ToppingID == 0 {
		t.Fatalf("bad independent topping copy: %+v", copied)
	}
	// Full product updates cannot forge canonical prices/labels or delete assignments.
	products, _ := s.Products(context.Background())
	var dish Product
	for _, p := range products {
		if p.ID == 1 {
			dish = p
		}
	}
	dish.Options[0].Price = 0
	dish.Options[0].Label = "forged"
	p, e := s.SaveProduct(context.Background(), dish)
	if e != nil || p.Options[0].Price != 30 || p.Options[0].Label == "forged" {
		t.Fatal("canonical option overwritten", e)
	}
}
