package app

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestOverlappingIntakeBlockers(t *testing.T) {
	p := Shop{Archived: true, Published: false, OwnerStopped: true, Settings: Settings{Paused: true, ScheduleEnabled: true}}
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	want := []string{"archived", "unpublished", "privacy_unpublished", "owner_stopped", "paused", "outside_hours"}
	if got := p.Blockers(now, false); !reflect.DeepEqual(got, want) {
		t.Fatalf("blockers=%v", got)
	}
	p = Shop{Published: true, Settings: Settings{ScheduleEnabled: true, OpeningHours: []OpeningHours{{Day: 4, Open: "22:00", Close: "04:00"}}}}
	if got := p.Blockers(time.Date(2026, 10, 15, 23, 0, 0, 0, time.UTC), true); len(got) != 0 {
		t.Fatalf("overnight blockers=%v", got)
	}
	p.Settings.Paused = true
	if got := p.Blockers(time.Date(2026, 10, 15, 23, 0, 0, 0, time.UTC), true); !reflect.DeepEqual(got, []string{"paused"}) {
		t.Fatalf("pause masks schedule: %v", got)
	}
}

func TestOwnerReportStoreFiltersAndScopedIsolation(t *testing.T) {
	s, a, owner := accessFixture(t)
	second := fixtureShop(t, a, owner)
	mustStatus(t, call(t, a, "PATCH", fmt.Sprintf("/api/owner/stores/%d", second.ID), map[string]bool{"published": true}, owner, a.Config.Origin), 200)
	p, e := s.SaveProduct(shopContext(context.Background(), second.ID), Product{Name: "Second menu", Price: 300, Available: true, Image: "/images/classic.jpg"})
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		c := checkout()
		c.RequestKey = fmt.Sprintf("owner-filter-%d-%s", i, strings.Repeat("x", 32))
		ctx := context.Background()
		if i == 1 {
			c.StoreID = second.ID
			c.Items = []CartItem{{ProductID: p.ID, Quantity: 1, ExpectedPrice: 300}}
			ctx = shopContext(ctx, second.ID)
		}
		if _, e = s.CreateOrder(ctx, c, a.orderToken(c.RequestKey)); e != nil {
			t.Fatal(e)
		}
	}
	for _, id := range []int64{1, second.ID} {
		for i := 0; i < 105; i++ {
			if _, e = s.DB.Exec("INSERT INTO audit_events(staff_name,store_id,action,resource,details) VALUES('Fixture',$1,'store.operations','fixture','{}')", id); e != nil {
				t.Fatal(e)
			}
		}
	}
	for _, endpoint := range []string{"orders", "activity"} {
		for _, bad := range []string{"0", "-1", "abc", "9223372036854775808"} {
			mustStatus(t, call(t, a, "GET", "/api/owner/"+endpoint+"?store_id="+bad, nil, owner, ""), 400)
		}
		mustStatus(t, call(t, a, "GET", "/api/owner/"+endpoint+"?store_id=999999", nil, owner, ""), 404)
		rr := call(t, a, "GET", fmt.Sprintf("/api/owner/%s?store_id=%d", endpoint, second.ID), nil, owner, "")
		mustStatus(t, rr, 200)
		var rows []struct {
			ID      int64 `json:"id"`
			StoreID int64 `json:"store_id"`
		}
		if e = json.Unmarshal(rr.Body.Bytes(), &rows); e != nil {
			t.Fatal(e)
		}
		want := 1
		if endpoint == "activity" {
			want = 100
		}
		if len(rows) != want {
			t.Fatalf("%s returned %d", endpoint, len(rows))
		}
		for _, r := range rows {
			if r.StoreID != second.ID {
				t.Fatalf("wrong store in %s", endpoint)
			}
		}
		if endpoint == "activity" {
			var total int
			if e = s.DB.QueryRow("SELECT count(*) FROM audit_events WHERE store_id=$1", second.ID).Scan(&total); e != nil {
				t.Fatal(e)
			}
			rr = call(t, a, "GET", fmt.Sprintf("/api/owner/activity?store_id=%d&before=%d", second.ID, rows[len(rows)-1].ID), nil, owner, "")
			mustStatus(t, rr, 200)
			if e = json.Unmarshal(rr.Body.Bytes(), &rows); e != nil {
				t.Fatal(e)
			}
			if len(rows) != total-100 {
				t.Fatalf("filter must precede pagination: %d", len(rows))
			}
		}
	}
	fixtureAccount(t, s, "report-manager", []Membership{{1, "manager"}}, false)
	manager := loginAccount(t, a, "report-manager", testPassword)
	for _, endpoint := range []string{"history", "activity"} {
		rr := call(t, a, "GET", fmt.Sprintf("/api/staff/stores/1/%s?store_id=%d", endpoint, second.ID), nil, manager, "")
		mustStatus(t, rr, 200)
		var rows []struct {
			StoreID int64 `json:"store_id"`
		}
		json.Unmarshal(rr.Body.Bytes(), &rows)
		for _, r := range rows {
			if r.StoreID != 1 {
				t.Fatal("query escaped authorized store")
			}
		}
	}
	mustStatus(t, call(t, a, "GET", "/api/owner/activity?store_id=1", nil, manager, ""), 403)
}
