package app

import (
	"time"

	"strings"

	"database/sql"

	"net/http"
)

type Analytics struct {
	From            string          `json:"from"`
	To              string          `json:"to"`
	StoreID         int64           `json:"store_id"`
	Orders          int             `json:"orders"`
	Statuses        map[string]int  `json:"statuses"`
	CompletedValue  int64           `json:"completed_value"`
	AverageBasket   float64         `json:"average_basket"`
	PrepMinutes     float64         `json:"preparation_minutes"`
	PrepSamples     int             `json:"preparation_samples"`
	ReadyMinutes    float64         `json:"ready_minutes"`
	ReadySamples    int             `json:"ready_samples"`
	Late            int             `json:"late_ready"`
	DeadlineSamples int             `json:"deadline_samples"`
	Daily           []DailyMetric   `json:"daily"`
	Products        []ProductMetric `json:"products"`
	Stores          []StoreMetric   `json:"stores"`
}

type DailyMetric struct {
	Date   string `json:"date"`
	Orders int    `json:"orders"`
	Value  int64  `json:"completed_value"`
}

type ProductMetric struct {
	Name     string `json:"name"`
	Quantity int    `json:"quantity"`
	Value    int64  `json:"value"`
}

type StoreMetric struct {
	StoreID     int64   `json:"store_id"`
	Orders      int     `json:"orders"`
	Value       int64   `json:"completed_value"`
	PrepMinutes float64 `json:"preparation_minutes"`
	Samples     int     `json:"preparation_samples"`
}

func (a *API) analytics(w http.ResponseWriter, r *http.Request) {
	zone := time.FixedZone("MSK", 10800)
	today := time.Now().In(zone).Format("2006-01-02")
	to := r.URL.Query().Get("to")
	if to == "" {
		to = today
	}
	end, e := time.ParseInLocation("2006-01-02", to, zone)
	if e != nil {
		fail(w, problem(400, "Проверьте даты."))
		return
	}
	from := r.URL.Query().Get("from")
	if from == "" {
		from = end.AddDate(0, 0, -6).Format("2006-01-02")
	}
	start, e := time.ParseInLocation("2006-01-02", from, zone)
	if e != nil || start.After(end) || end.Sub(start) > 365*24*time.Hour {
		fail(w, problem(400, "Период: не более одного года."))
		return
	}
	end = end.AddDate(0, 0, 1)
	id, ok := a.reportStore(w, r)
	if !ok {
		return
	}
	report := Analytics{From: from, To: to, StoreID: id, Statuses: map[string]int{}, Daily: []DailyMetric{}, Products: []ProductMetric{}, Stores: []StoreMetric{}}
	ctx := r.Context()
	tx, e := a.Store.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	where := " FROM privacy_analytics WHERE day >= ($1::timestamptz AT TIME ZONE 'Europe/Moscow')::date AND day < ($2::timestamptz AT TIME ZONE 'Europe/Moscow')::date AND ($3::bigint=0 OR store_id=$3) "
	rows, e := tx.QueryContext(ctx, "SELECT status,sum(orders),sum(value)"+where+"GROUP BY status", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	for rows.Next() {
		var status string
		var count int
		var value int64
		if e = rows.Scan(&status, &count, &value); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		report.Orders += count
		report.Statuses[status] = count
		if status == "completed" {
			report.CompletedValue = value
			if count > 0 {
				report.AverageBasket = float64(value) / float64(count)
			}
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	e = tx.QueryRowContext(ctx, `SELECT COALESCE(sum(prep_sum)/NULLIF(sum(prep_samples),0),0),COALESCE(sum(prep_samples),0),COALESCE(sum(ready_sum)/NULLIF(sum(ready_samples),0),0),COALESCE(sum(ready_samples),0),COALESCE(sum(late),0),COALESCE(sum(deadline_samples),0)`+where, start, end, id).Scan(&report.PrepMinutes, &report.PrepSamples, &report.ReadyMinutes, &report.ReadySamples, &report.Late, &report.DeadlineSamples)
	if e != nil {
		fail(w, e)
		return
	}
	rows, e = tx.QueryContext(ctx, "SELECT to_char(day,'YYYY-MM-DD'),sum(orders),sum(value)"+where+"GROUP BY 1 ORDER BY 1", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	for rows.Next() {
		var d DailyMetric
		if e = rows.Scan(&d.Date, &d.Orders, &d.Value); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		report.Daily = append(report.Daily, d)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	productWhere := strings.Replace(where, "privacy_analytics", "privacy_product_analytics", 1)
	rows, e = tx.QueryContext(ctx, "SELECT name,sum(quantity),sum(value)"+productWhere+"GROUP BY name ORDER BY 2 DESC,1 LIMIT 20", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	for rows.Next() {
		var p ProductMetric
		if e = rows.Scan(&p.Name, &p.Quantity, &p.Value); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		report.Products = append(report.Products, p)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	rows, e = tx.QueryContext(ctx, "SELECT store_id,sum(orders),sum(value),COALESCE(sum(prep_sum)/NULLIF(sum(prep_samples),0),0),sum(prep_samples)"+where+"GROUP BY store_id ORDER BY store_id", start, end, id)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var m StoreMetric
		if e = rows.Scan(&m.StoreID, &m.Orders, &m.Value, &m.PrepMinutes, &m.Samples); e != nil {
			fail(w, e)
			return
		}
		report.Stores = append(report.Stores, m)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	rows.Close()
	if e = tx.Commit(); e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, report)
}
