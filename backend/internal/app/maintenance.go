package app

import "context"

// Security cleanup only. Receipt retention uses the explicit journalled privacy CLI.
func (s *Store) Maintenance(ctx context.Context, retentionDays int) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<now()"); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM rate_limits WHERE window_start<=now()-interval '23 hours'"); e != nil {
		return e
	}
	return tx.Commit()
}
