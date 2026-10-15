package app

import (
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type Product struct {
	ID          int64           `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Price       int             `json:"price"`
	Image       string          `json:"image"`
	Weight      string          `json:"weight"`
	Category    string          `json:"category"`
	Available   bool            `json:"available"`
	SortOrder   int             `json:"sort_order"`
	Ingredients string          `json:"ingredients"`
	Allergens   string          `json:"allergens"`
	Options     []ProductOption `json:"options"`
}
type ProductOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Price int    `json:"price"`
}
type OpeningHours struct {
	Day   int    `json:"day"`
	Open  string `json:"open"`
	Close string `json:"close"`
}
type Settings struct {
	Paused          bool           `json:"paused"`
	PrepMinutes     int            `json:"prep_minutes"`
	PauseMessage    string         `json:"pause_message"`
	ShopName        string         `json:"shop_name"`
	Address         string         `json:"address"`
	City            string         `json:"city"`
	Phone           string         `json:"phone"`
	HoursNote       string         `json:"hours_note"`
	MapURL          string         `json:"map_url"`
	OpeningHours    []OpeningHours `json:"opening_hours"`
	ScheduleEnabled bool           `json:"schedule_enabled"`
	DemoMode        bool           `json:"demo_mode"`
}
type CartItem struct {
	ProductID     int64    `json:"product_id"`
	Quantity      int      `json:"quantity"`
	ExpectedPrice int      `json:"expected_price"`
	Options       []string `json:"options,omitempty"`
}
type Checkout struct {
	Name       string         `json:"name"`
	Note       string         `json:"note"`
	RequestKey string         `json:"request_key"`
	Items      []CartItem     `json:"items"`
	StoreID    int64          `json:"store_id,omitempty"`
	Privacy    *PrivacyChoice `json:"privacy,omitempty"`
}
type OrderItem struct {
	ProductID int64           `json:"product_id"`
	Name      string          `json:"name"`
	Price     int             `json:"price"`
	Quantity  int             `json:"quantity"`
	Options   []ProductOption `json:"options,omitempty"`
}
type Order struct {
	ID                 int64       `json:"id,omitempty"`
	Number             int64       `json:"number"`
	Name               string      `json:"name,omitempty"`
	Note               string      `json:"note,omitempty"`
	Status             string      `json:"status"`
	Total              int         `json:"total"`
	Items              []OrderItem `json:"items"`
	EstimatedReadyAt   time.Time   `json:"estimated_ready_at"`
	CreatedAt          time.Time   `json:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at"`
	Token              string      `json:"token,omitempty"`
	CancellationReason string      `json:"cancellation_reason,omitempty"`
	StoreID            int64       `json:"store_id"`
	StoreSlug          string      `json:"store_slug"`
	Shop               *Settings   `json:"shop,omitempty"`
	CancelledBy        string      `json:"cancelled_by,omitempty"`
}
type OrderUpdate struct {
	Status             string `json:"status"`
	ETAMinutes         *int   `json:"eta_minutes"`
	CancellationReason string `json:"cancellation_reason,omitempty"`
}
type Problem struct {
	Status  int
	Message string
}

func (e *Problem) Error() string               { return e.Message }
func problem(status int, message string) error { return &Problem{status, message} }

var ErrMissing = errors.New("missing")

func (c *Checkout) Validate() error {
	c.Name = strings.TrimSpace(c.Name)
	c.Note = strings.TrimSpace(c.Note)
	if c.StoreID < 0 || utf8.RuneCountInString(c.Name) > 60 {
		return problem(400, "Проверьте имя и точку получения.")
	}
	if utf8.RuneCountInString(c.Note) > 500 {
		return problem(400, "Комментарий не должен превышать 500 символов.")
	}
	if len(c.RequestKey) < 32 || len(c.RequestKey) > 80 {
		return problem(400, "Некорректный ключ заказа.")
	}
	for _, ch := range c.RequestKey {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-') {
			return problem(400, "Некорректный ключ заказа.")
		}
	}
	if len(c.Items) < 1 || len(c.Items) > 30 {
		return problem(400, "Добавьте товары в корзину.")
	}
	seen := map[string]bool{}
	count := 0
	for _, item := range c.Items {
		key := fmt.Sprint(item.ProductID)
		selected := map[string]bool{}
		if len(item.Options) > 12 {
			return problem(400, "Слишком много опций товара.")
		}
		for _, option := range item.Options {
			if selected[option] || len(option) < 1 || len(option) > 40 {
				return problem(400, "Проверьте опции товара.")
			}
			selected[option] = true
		}
		sorted := append([]string{}, item.Options...)
		sort.Strings(sorted)
		key += ":" + strings.Join(sorted, ",")
		if item.ProductID < 1 || item.Quantity < 1 || item.Quantity > 20 || item.ExpectedPrice < 1 || seen[key] {
			return problem(400, "Проверьте состав корзины.")
		}
		seen[key] = true
		count += item.Quantity
	}
	if count > 50 {
		return problem(400, "В одном заказе может быть не более 50 позиций.")
	}
	return nil
}
func ValidTransition(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "new":
		return to == "preparing" || to == "cancelled"
	case "preparing":
		return to == "ready" || to == "cancelled"
	case "ready":
		return to == "completed" || to == "cancelled"
	}
	return false
}
func (p *Product) Validate() error {
	p.Name = strings.TrimSpace(p.Name)
	p.Description = strings.TrimSpace(p.Description)
	if utf8.RuneCountInString(p.Name) < 1 || utf8.RuneCountInString(p.Name) > 100 || utf8.RuneCountInString(p.Description) > 600 || p.Price < 1 || p.Price > 1000000 || len(p.Weight) > 40 || len(p.Category) > 100 || p.SortOrder < 0 || p.SortOrder > 10000 {
		return problem(400, "Проверьте название, цену и описание товара.")
	}
	if len(p.Image) > 1000 {
		return problem(400, "Слишком длинный адрес фотографии.")
	}
	if !strings.HasPrefix(p.Image, "/images/") {
		u, e := url.Parse(p.Image)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return problem(400, "Фото: путь /images/... или адрес https://.")
		}
	}
	if p.Category == "" {
		p.Category = "Шаверма"
	}
	if utf8.RuneCountInString(p.Ingredients) > 600 || utf8.RuneCountInString(p.Allergens) > 300 || len(p.Options) > 12 {
		return problem(400, "Проверьте состав, аллергены и опции.")
	}
	seen := map[string]bool{}
	for _, option := range p.Options {
		if len(option.ID) < 1 || len(option.ID) > 40 || strings.ContainsAny(option.ID, ",:") || seen[option.ID] || strings.TrimSpace(option.Label) == "" || utf8.RuneCountInString(option.Label) > 80 || option.Price < 0 || option.Price > 10000 {
			return problem(400, "Проверьте опции товара.")
		}
		seen[option.ID] = true
	}
	if p.Options == nil {
		p.Options = []ProductOption{}
	}
	return nil
}
func (s Settings) Validate() error {
	if s.PrepMinutes < 1 || s.PrepMinutes > 120 || utf8.RuneCountInString(s.PauseMessage) > 300 {
		return problem(400, "Время приготовления: от 1 до 120 минут.")
	}
	if len(s.ShopName) > 200 || len(s.Address) > 400 || len(s.City) > 200 || len(s.Phone) > 50 || len(s.HoursNote) > 500 || len(s.MapURL) > 1000 {
		return problem(400, "Проверьте информацию о заведении.")
	}
	if s.MapURL != "" {
		u, e := url.Parse(s.MapURL)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return problem(400, "Ссылка на карту должна начинаться с https://.")
		}
	}
	seen := map[int]bool{}
	for _, hours := range s.OpeningHours {
		if hours.Day < 0 || hours.Day > 6 || seen[hours.Day] {
			return problem(400, "Проверьте дни работы.")
		}
		if _, e := time.Parse("15:04", hours.Open); e != nil {
			return problem(400, "Проверьте время открытия.")
		}
		if _, e := time.Parse("15:04", hours.Close); e != nil || hours.Open == hours.Close {
			return problem(400, "Проверьте время закрытия.")
		}
		seen[hours.Day] = true
	}
	return nil
}

// Overnight hours belong to the day on which the shop opens. No schedule means manual intake.
func (s Settings) Intake(now time.Time) (bool, string) {
	if s.Paused {
		if s.PauseMessage != "" {
			return false, s.PauseMessage
		}
		return false, "Приём заказов временно приостановлен."
	}
	if !s.ScheduleEnabled {
		return true, "Принимаем заказы"
	}
	now = now.In(time.FixedZone("MSK", 3*60*60))
	day, clock := int(now.Weekday()), now.Format("15:04")
	for _, h := range s.OpeningHours {
		if h.Open < h.Close && day == h.Day && clock >= h.Open && clock < h.Close {
			return true, "Принимаем заказы"
		}
		if h.Open > h.Close && ((day == h.Day && clock >= h.Open) || (day == (h.Day+1)%7 && clock < h.Close)) {
			return true, "Принимаем заказы"
		}
	}
	return false, "Сейчас закрыто. Заказы принимаем в часы работы."
}
func ValidateUpdate(u OrderUpdate) error {
	if u.Status == "cancelled" && strings.TrimSpace(u.CancellationReason) == "" {
		return problem(400, "Укажите причину отмены.")
	}
	if utf8.RuneCountInString(u.CancellationReason) > 300 || (u.CancellationReason != "" && u.Status != "cancelled") {
		return problem(400, "Причина отмены: до 300 символов, только при отмене заказа.")
	}
	if u.ETAMinutes != nil && (*u.ETAMinutes < 1 || *u.ETAMinutes > 120) {
		return problem(400, "Укажите время от 1 до 120 минут.")
	}
	if u.Status != "" {
		switch u.Status {
		case "new", "preparing", "ready", "completed", "cancelled":
		default:
			return problem(400, fmt.Sprintf("Неизвестный статус: %s", u.Status))
		}
	}
	return nil
}
