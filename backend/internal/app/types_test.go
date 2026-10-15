package app

import (
	"strings"
	"testing"
)

func checkout() Checkout {
	return Checkout{Privacy: &PrivacyChoice{NoticeVersion: 1, ConsentVersion: 1, Accepted: true}, Name: "Михаил", RequestKey: strings.Repeat("a", 36), Items: []CartItem{{ProductID: 1, Quantity: 2, ExpectedPrice: 290}}}
}
func TestCheckoutValidation(t *testing.T) {
	cases := []struct {
		name   string
		change func(*Checkout)
		ok     bool
	}{
		{"valid", func(c *Checkout) {}, true},
		{"unicode name", func(c *Checkout) { c.Name = "  Михаил  " }, true},
		{"empty name", func(c *Checkout) { c.Name = " " }, true},
		{"long name", func(c *Checkout) { c.Name = strings.Repeat("я", 61) }, false},
		{"long note", func(c *Checkout) { c.Note = strings.Repeat("я", 501) }, false},
		{"empty cart", func(c *Checkout) { c.Items = nil }, false},
		{"negative quantity", func(c *Checkout) { c.Items[0].Quantity = -1 }, false},
		{"large quantity", func(c *Checkout) { c.Items[0].Quantity = 21 }, false},
		{"duplicate products", func(c *Checkout) { c.Items = append(c.Items, c.Items[0]) }, false},
		{"invalid price", func(c *Checkout) { c.Items[0].ExpectedPrice = 0 }, false},
		{"weak request key", func(c *Checkout) { c.RequestKey = "1" }, false},
		{"invalid key chars", func(c *Checkout) { c.RequestKey = strings.Repeat("/", 36) }, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := checkout()
			tc.change(&c)
			if (c.Validate() == nil) != tc.ok {
				t.Fatalf("wrong result: %+v", c)
			}
		})
	}
}
func TestTransitions(t *testing.T) {
	statuses := []string{"new", "preparing", "ready", "completed", "cancelled"}
	allowed := map[string]bool{"new:preparing": true, "new:cancelled": true, "preparing:ready": true, "preparing:cancelled": true, "ready:completed": true, "ready:cancelled": true}
	for _, from := range statuses {
		for _, to := range statuses {
			want := from == to || allowed[from+":"+to]
			if ValidTransition(from, to) != want {
				t.Fatalf("%s -> %s", from, to)
			}
		}
	}
}
func TestProductValidation(t *testing.T) {
	for _, image := range []string{"javascript:alert(1)", "http://example.com/a.jpg", "//example.com/a.jpg", "data:image/jpeg;base64,x", "https://"} {
		p := Product{Name: "Тест", Price: 100, Image: image}
		if p.Validate() == nil {
			t.Fatalf("accepted image %s", image)
		}
	}
	for _, image := range []string{"/images/classic.jpg", "https://example.com/photo.jpg"} {
		p := Product{Name: "Тест", Price: 100, Image: image}
		if e := p.Validate(); e != nil {
			t.Fatal(e)
		}
	}
}
func TestUpdateValidation(t *testing.T) {
	bad := 0
	if ValidateUpdate(OrderUpdate{ETAMinutes: &bad}) == nil {
		t.Fatal("accepted zero ETA")
	}
	if ValidateUpdate(OrderUpdate{Status: "paid"}) == nil {
		t.Fatal("accepted invented status")
	}
}
