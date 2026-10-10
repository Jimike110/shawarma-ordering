package app

import "context"

// Closed order deletion is disabled unless the operator explicitly configures retention.
func (s *Store) Maintenance(ctx context.Context, retentionDays int) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<now()"); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM rate_limits WHERE window_start<now()-interval '24 hours'"); e != nil {
		return e
	}
	if retentionDays >= 30 {
		if _, e = tx.ExecContext(ctx, "DELETE FROM orders WHERE status IN ('completed','cancelled') AND updated_at < now()-($1 * interval '1 day')", retentionDays); e != nil {
			return e
		}
	}
	return tx.Commit()
}
