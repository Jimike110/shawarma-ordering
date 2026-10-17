package app

import (
	"errors"

	"strings"

	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
)

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, e error) {
	var p *Problem
	switch {
	case errors.As(e, &p):
		reply(w, p.Status, map[string]string{"error": p.Message})
	case errors.Is(e, ErrMissing):
		reply(w, 404, map[string]string{"error": "Заказ или товар не найден."})
	default:
		log.Printf("API request failed (%T)", e)
		reply(w, 500, map[string]string{"error": "Не удалось выполнить запрос. Попробуйте ещё раз."})
	}
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		reply(w, 415, map[string]string{"error": "Ожидается JSON."})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(value); e != nil {
		reply(w, 400, map[string]string{"error": "Некорректные данные запроса."})
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		reply(w, 400, map[string]string{"error": "Некорректные данные запроса."})
		return false
	}
	return true
}

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || id < 1 {
		fail(w, ErrMissing)
		return 0, false
	}
	return id, true
}
