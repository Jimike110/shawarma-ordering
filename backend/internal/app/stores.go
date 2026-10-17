package app

import (
	"context"

	"database/sql"
	"time"
)

type Shop struct {
	ID             int64          `json:"id"`
	Slug           string         `json:"slug"`
	Published      bool           `json:"published"`
	Archived       bool           `json:"archived"`
	OwnerStopped   bool           `json:"owner_stopped"`
	StopReason     string         `json:"stop_reason"`
	Settings       Settings       `json:"settings"`
	Role           string         `json:"role,omitempty"`
	Accepting      bool           `json:"accepting_orders"`
	Message        string         `json:"intake_message"`
	Counts         map[string]int `json:"counts,omitempty"`
	IntakeBlockers []string       `json:"intake_blockers"`
}

func (s *Store) Shop(ctx context.Context, id int64) (Shop, error) {
	var p Shop
	e := s.DB.QueryRowContext(ctx, "SELECT id,slug,published,archived,owner_stopped,stop_reason FROM stores WHERE id=$1", id).Scan(&p.ID, &p.Slug, &p.Published, &p.Archived, &p.OwnerStopped, &p.StopReason)
	if e == sql.ErrNoRows {
		return p, ErrMissing
	}
	if e != nil {
		return p, e
	}
	p.Settings, e = s.Settings(shopContext(ctx, id))
	if e != nil {
		return p, e
	}
	now := time.Now()
	p.Accepting, p.Message = p.Intake(now)
	var privacyReady bool
	if e = s.DB.QueryRowContext(ctx, "SELECT current_version IS NOT NULL FROM privacy_settings WHERE id=1").Scan(&privacyReady); e != nil {
		return p, e
	}
	if !privacyReady {
		p.Accepting = false
		p.Message = "Оператор ещё не опубликовал документы. Приём новых заказов недоступен."
	}
	p.IntakeBlockers = p.Blockers(now, privacyReady)
	return p, nil
}

// Blockers explain every independent intake condition without changing enforcement.
func (s Shop) Blockers(now time.Time, privacyReady bool) []string {
	out := []string{}
	if s.Archived {
		out = append(out, "archived")
	}
	if !s.Published {
		out = append(out, "unpublished")
	}
	if !privacyReady {
		out = append(out, "privacy_unpublished")
	}
	if s.OwnerStopped {
		out = append(out, "owner_stopped")
	}
	if s.Settings.Paused {
		out = append(out, "paused")
	}
	schedule := s.Settings
	schedule.Paused = false
	if open, _ := schedule.Intake(now); !open {
		out = append(out, "outside_hours")
	}
	return out
}

func (s Shop) Intake(now time.Time) (bool, string) {
	if s.Archived || !s.Published {
		return false, "Точка пока не принимает заказы."
	}
	if s.OwnerStopped {
		return false, "Приём заказов остановлен владельцем."
	}
	return s.Settings.Intake(now)
}

func (s *Store) Shops(ctx context.Context, public bool) ([]Shop, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT id FROM stores WHERE NOT $1 OR (published AND NOT archived) ORDER BY id", public)
	if e != nil {
		return nil, e
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return nil, e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	out := []Shop{}
	for _, id := range ids {
		if !public && actor(ctx).Role(id) == "" {
			continue
		}
		p, e := s.Shop(ctx, id)
		if e != nil {
			return nil, e
		}
		if public {
			p.StopReason = ""
		}
		if !public {
			p.Role = actor(ctx).Role(id)
			p.Counts = map[string]int{}
			r, e := s.DB.QueryContext(ctx, "SELECT status,count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing','ready') GROUP BY status", id)
			if e != nil {
				return nil, e
			}
			for r.Next() {
				var status string
				var count int
				if e = r.Scan(&status, &count); e != nil {
					r.Close()
					return nil, e
				}
				p.Counts[status] = count
			}
			e = r.Err()
			r.Close()
			if e != nil {
				return nil, e
			}
			var late int
			if e = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM orders WHERE store_id=$1 AND status IN ('new','preparing') AND estimated_ready_at<now()", id).Scan(&late); e != nil {
				return nil, e
			}
			p.Counts["overdue"] = late
		}
		out = append(out, p)
	}
	return out, nil
}
