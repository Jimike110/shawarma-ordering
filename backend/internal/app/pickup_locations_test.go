package app

import (
	"context"
	"encoding/json"
	"math"
	"testing"
)

func TestPickupLocationValidation(t *testing.T) {
	lat, lon := 59.935643, 30.499839
	valid := Settings{PrepMinutes: 15, Latitude: &lat, Longitude: &lon}
	if e := valid.Validate(); e != nil {
		t.Fatal(e)
	}
	cases := []Settings{valid, valid, valid, valid}
	cases[0].Longitude = nil
	invalid := 91.0
	cases[1].Latitude = &invalid
	nan := math.NaN()
	cases[2].Latitude = &nan
	infinity := math.Inf(1)
	cases[3].Longitude = &infinity
	for _, st := range cases {
		if st.Validate() == nil {
			t.Fatal("invalid coordinates accepted")
		}
	}
}
func TestPickupLocationPermissionsAndSnapshots(t *testing.T) {
	s, a, owner := accessFixture(t)
	ctx := context.Background()
	st, e := s.Settings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	lat, lon := 59.935643, 30.499839
	st.Latitude = &lat
	st.Longitude = &lon
	st.Landmark = "Проверенный ориентир"
	st.Entrance = "Вход со двора"
	mustStatus(t, call(t, a, "PUT", "/api/staff/stores/1/settings", st, owner, a.Config.Origin), 200)
	saved, e := s.Settings(ctx)
	if e != nil || saved.Latitude == nil || *saved.Latitude != lat || saved.Entrance != st.Entrance {
		t.Fatal("location roundtrip", e)
	}
	rr := call(t, a, "GET", "/api/stores", nil, nil, "")
	mustStatus(t, rr, 200)
	var stores []Shop
	if e = json.Unmarshal(rr.Body.Bytes(), &stores); e != nil {
		t.Fatal(e)
	}
	if len(stores) != 1 || stores[0].Settings.Latitude == nil || stores[0].Settings.Landmark != st.Landmark {
		t.Fatal("public store location missing")
	}
	input := checkout()
	receipt, e := s.CreateOrder(ctx, input, "synthetic-pickup-private-link")
	if e != nil {
		t.Fatal(e)
	}
	nextLat := 60.0
	st.Latitude = &nextLat
	mustStatus(t, call(t, a, "PUT", "/api/staff/stores/1/settings", st, owner, a.Config.Origin), 200)
	retry, e := s.CreateOrder(ctx, input, "synthetic-pickup-private-link")
	if e != nil || retry.ID != receipt.ID || retry.Shop == nil || retry.Shop.Latitude == nil || *retry.Shop.Latitude != lat {
		t.Fatal("location change rewrote an accepted receipt/retry", e)
	}
	fixtureAccount(t, s, "pickupworker", []Membership{{1, "worker"}}, false)
	worker := loginAccount(t, a, "pickupworker", testPassword)
	mustStatus(t, call(t, a, "PUT", "/api/staff/stores/1/settings", st, worker, a.Config.Origin), 403)
	mustStatus(t, call(t, a, "PATCH", "/api/staff/stores/1/operations", map[string]any{"latitude": 1, "longitude": 2}, worker, a.Config.Origin), 400)
	mustStatus(t, call(t, a, "GET", "/api/staff/stores/999/menu", nil, worker, ""), 403)
}
