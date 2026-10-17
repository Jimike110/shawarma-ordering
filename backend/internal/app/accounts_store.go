package app

import (
	"context"

	"unicode/utf8"

	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

const accountCols = "id,username,display_name,phone,email,owner,active,password_required,last_login_at,password_hash,temporary_until,version,account_type,COALESCE(kitchen_store_id,0)"

func scanAccount(row interface{ Scan(...any) error }) (Account, error) {
	var u Account
	e := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Phone, &u.Email, &u.Owner, &u.Active, &u.PasswordRequired, &u.LastLogin, &u.PasswordHash, &u.TemporaryUntil, &u.Version, &u.AccountType, &u.KitchenStoreID)
	u.Memberships = []Membership{}
	return u, e
}

func (s *Store) memberships(ctx context.Context, u *Account) error {
	if u.AccountType == "kitchen" {
		u.Memberships = []Membership{{StoreID: u.KitchenStoreID, Role: "worker"}}
		return nil
	}
	rows, e := s.DB.QueryContext(ctx, "SELECT store_id,role FROM staff_memberships WHERE user_id=$1 ORDER BY store_id", u.ID)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var m Membership
		if e = rows.Scan(&m.StoreID, &m.Role); e != nil {
			return e
		}
		u.Memberships = append(u.Memberships, m)
	}
	return rows.Err()
}

func (s *Store) account(ctx context.Context, id int64) (Account, error) {
	u, e := scanAccount(s.DB.QueryRowContext(ctx, "SELECT "+accountCols+" FROM staff_accounts WHERE id=$1", id))
	if e == nil {
		e = s.memberships(ctx, &u)
	}
	return u, e
}

func (s *Store) Accounts(ctx context.Context) ([]Account, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT "+accountCols+" FROM staff_accounts WHERE account_type='person' ORDER BY active DESC,display_name,id")
	if e != nil {
		return nil, e
	}
	users := []Account{}
	for rows.Next() {
		u, e := scanAccount(rows)
		if e != nil {
			rows.Close()
			return nil, e
		}
		users = append(users, u)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for i := range users {
		if e = s.memberships(ctx, &users[i]); e != nil {
			return nil, e
		}
	}
	return users, nil
}

type UserInput struct {
	Username    string       `json:"username"`
	DisplayName string       `json:"display_name"`
	Phone       string       `json:"phone"`
	Email       string       `json:"email"`
	Owner       bool         `json:"owner"`
	Active      bool         `json:"active"`
	Memberships []Membership `json:"memberships"`
}

func (s *Store) SaveAccount(ctx context.Context, id int64, in UserInput, hash string, temporary bool) (Account, error) {
	in.Username = NormalizeUsername(in.Username)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	if !usernamePattern.MatchString(in.Username) || in.DisplayName == "" || utf8.RuneCountInString(in.DisplayName) > 100 || len(in.Phone) > 50 || len(in.Email) > 254 || len(in.Memberships) > 100 {
		return Account{}, problem(400, "Проверьте логин (3–60 латинских символов), имя и контакты.")
	}
	seen := map[int64]bool{}
	for _, m := range in.Memberships {
		if m.StoreID < 1 || seen[m.StoreID] || (m.Role != "worker" && m.Role != "manager") {
			return Account{}, problem(400, "Проверьте назначения точек.")
		}
		seen[m.StoreID] = true
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Account{}, e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184015)"); e != nil {
		return Account{}, e
	}
	var duplicate bool
	if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM staff_accounts WHERE username=$1 AND id<>$2)", in.Username, id).Scan(&duplicate); e != nil {
		return Account{}, e
	}
	if duplicate {
		return Account{}, problem(409, "Этот логин уже используется.")
	}
	if id > 0 {
		var kind string
		if e = tx.QueryRowContext(ctx, "SELECT account_type FROM staff_accounts WHERE id=$1", id).Scan(&kind); e != nil {
			return Account{}, e
		}
		if kind != "person" {
			return Account{}, problem(400, "Общий доступ точки изменяется в разделе устройств кухни.")
		}
		var owner, active bool
		e = tx.QueryRowContext(ctx, "SELECT owner,active FROM staff_accounts WHERE id=$1 FOR UPDATE", id).Scan(&owner, &active)
		if e == sql.ErrNoRows {
			return Account{}, ErrMissing
		}
		if e != nil {
			return Account{}, e
		}
		if owner && active && (!in.Owner || !in.Active) {
			var count int
			e = tx.QueryRowContext(ctx, "SELECT count(*) FROM staff_accounts WHERE owner AND active").Scan(&count)
			if e != nil {
				return Account{}, e
			}
			if count <= 1 {
				return Account{}, problem(409, "Нельзя отключить последнего владельца.")
			}
		}
	}
	for _, m := range in.Memberships {
		if in.Owner {
			break
		}
		var exists bool
		if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM stores WHERE id=$1 AND (NOT archived OR EXISTS(SELECT 1 FROM staff_memberships WHERE user_id=$2 AND store_id=$1)))", m.StoreID, id).Scan(&exists); e != nil {
			return Account{}, e
		}
		if !exists {
			return Account{}, problem(400, "Точка назначения недоступна.")
		}
	}
	if id == 0 {
		if hash == "" {
			return Account{}, problem(400, "Нужен пароль.")
		}
		e = tx.QueryRowContext(ctx, "INSERT INTO staff_accounts(username,display_name,phone,email,owner,active,password_hash,password_required,temporary_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8 THEN now()+interval '24 hours' ELSE NULL END) RETURNING id", in.Username, in.DisplayName, in.Phone, in.Email, in.Owner, in.Active, hash, temporary).Scan(&id)
	} else {
		_, e = tx.ExecContext(ctx, "UPDATE staff_accounts SET username=$1,display_name=$2,phone=$3,email=$4,owner=$5,active=$6,version=version+1 WHERE id=$7", in.Username, in.DisplayName, in.Phone, in.Email, in.Owner, in.Active, id)
		if e == nil {
			_, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id)
		}
	}
	if e != nil {
		return Account{}, e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM staff_memberships WHERE user_id=$1", id); e != nil {
		return Account{}, e
	}
	if !in.Owner {
		for _, m := range in.Memberships {
			if _, e = tx.ExecContext(ctx, "INSERT INTO staff_memberships VALUES($1,$2,$3)", id, m.StoreID, m.Role); e != nil {
				return Account{}, e
			}
		}
	}
	details, _ := json.Marshal(map[string]any{"owner": in.Owner, "active": in.Active, "memberships": in.Memberships})
	if e = auditDetails(ctx, tx, "account.save", fmt.Sprint(id), details); e != nil {
		return Account{}, e
	}
	if e = tx.Commit(); e != nil {
		return Account{}, e
	}
	return s.account(ctx, id)
}

func (s *Store) ResetPassword(ctx context.Context, id int64, hash string, temporary bool) error {
	var kind string
	if e := s.DB.QueryRowContext(ctx, "SELECT account_type FROM staff_accounts WHERE id=$1", id).Scan(&kind); e != nil {
		return e
	}
	if kind != "person" {
		return problem(400, "Используйте смену пароля общего доступа точки.")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	result, e := tx.ExecContext(ctx, "UPDATE staff_accounts SET password_hash=$1,password_required=$2,temporary_until=CASE WHEN $2 THEN now()+interval '24 hours' ELSE NULL END,version=version+1 WHERE id=$3", hash, temporary, id)
	if e != nil {
		return e
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrMissing
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
		return e
	}
	if e = audit(ctx, tx, "account.password_reset", fmt.Sprint(id)); e != nil {
		return e
	}
	return tx.Commit()
}

func (s *Store) BootstrapOwner(ctx context.Context, username, name, password string) error {
	hash, e := PasswordHash(password)
	if e != nil {
		return e
	}
	username = NormalizeUsername(username)
	if !usernamePattern.MatchString(username) || strings.TrimSpace(name) == "" {
		return problem(400, "Проверьте логин и имя владельца.")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184015)"); e != nil {
		return e
	}
	var count int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM staff_accounts WHERE owner").Scan(&count); e != nil {
		return e
	}
	if count != 0 {
		return problem(409, "Владелец уже создан. Используйте recovery.")
	}
	var id int64
	e = tx.QueryRowContext(ctx, "INSERT INTO staff_accounts(username,display_name,owner,password_hash) VALUES($1,$2,true,$3) RETURNING id", username, name, hash).Scan(&id)
	if e != nil {
		return e
	}
	if e = audit(ctx, tx, "account.bootstrap", fmt.Sprint(id)); e != nil {
		return e
	}
	return tx.Commit()
}

// Recovery is available only to a database administrator through the CLI.
func (s *Store) RecoverOwner(ctx context.Context, username, password string) error {
	hash, e := PasswordHash(password)
	if e != nil {
		return e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(184015)"); e != nil {
		return e
	}
	var id int64
	e = tx.QueryRowContext(ctx, "UPDATE staff_accounts SET active=true,password_hash=$1,password_required=false,temporary_until=NULL,version=version+1 WHERE username=$2 AND owner RETURNING id", hash, NormalizeUsername(username)).Scan(&id)
	if e == sql.ErrNoRows {
		return ErrMissing
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
		return e
	}
	if e = audit(ctx, tx, "account.recovery", fmt.Sprint(id)); e != nil {
		return e
	}
	return tx.Commit()
}
