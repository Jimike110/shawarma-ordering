package app

import (
	"encoding/json"
	"strings"

	"context"
)

func (s *Store) Settings(ctx context.Context) (Settings, error) {
	return scanSettings(s.DB.QueryRowContext(ctx, "SELECT "+settingsCols+" FROM settings WHERE id=$1", shopID(ctx)))
}

const settingsCols = "paused,prep_minutes,pause_message,shop_name,address,city,phone,hours_note,map_url,opening_hours,schedule_enabled,demo_mode,latitude,longitude,landmark,entrance"

func scanSettings(row interface{ Scan(...any) error }) (Settings, error) {
	var st Settings
	var raw []byte
	e := row.Scan(&st.Paused, &st.PrepMinutes, &st.PauseMessage, &st.ShopName, &st.Address, &st.City, &st.Phone, &st.HoursNote, &st.MapURL, &raw, &st.ScheduleEnabled, &st.DemoMode, &st.Latitude, &st.Longitude, &st.Landmark, &st.Entrance)
	if e == nil {
		e = json.Unmarshal(raw, &st.OpeningHours)
	}
	return st, e
}

func (s *Store) SaveSettings(ctx context.Context, st Settings) error {
	raw, _ := json.Marshal(st.OpeningHours)
	if st.OpeningHours == nil {
		raw = []byte("[]")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT id FROM stores WHERE id=$1 FOR UPDATE", shopID(ctx)); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "UPDATE settings SET paused=$1,prep_minutes=$2,pause_message=$3,shop_name=$4,address=$5,city=$6,phone=$7,hours_note=$8,map_url=$9,opening_hours=$10,schedule_enabled=$11,demo_mode=$12,latitude=$14,longitude=$15,landmark=$16,entrance=$17 WHERE id=$13", st.Paused, st.PrepMinutes, st.PauseMessage, st.ShopName, st.Address, st.City, st.Phone, st.HoursNote, st.MapURL, raw, st.ScheduleEnabled, st.DemoMode, shopID(ctx), st.Latitude, st.Longitude, strings.TrimSpace(st.Landmark), strings.TrimSpace(st.Entrance))
	if e != nil {
		return e
	}
	if e = auditDetails(ctx, tx, "settings.update", "shop", mustJSON(st)); e != nil {
		return e
	}
	return tx.Commit()
}
