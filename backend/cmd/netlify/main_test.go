package main

import (
	"context"
	"encoding/base64"
	"github.com/aws/aws-lambda-go/events"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestProxyPreservesRoutingBodyAndCookies(t *testing.T) {
	event := events.APIGatewayProxyRequest{HTTPMethod: "POST", Path: "/.netlify/functions/api", QueryStringParameters: map[string]string{"route": "kitchen/login", "extra": "a b"}, Body: base64.StdEncoding.EncodeToString([]byte("{\"password\":\"example\"}")), IsBase64Encoded: true, Headers: map[string]string{"Origin": "http://localhost:5173", "Content-Type": "application/json"}}
	event.RequestContext.Identity.SourceIP = "192.0.2.10"
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/kitchen/login" || r.URL.Query().Get("extra") != "a b" {
			t.Fatal(r.URL)
		}
		raw, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(raw), "password") {
			t.Fatal("body lost")
		}
		if r.RemoteAddr != "192.0.2.10" || r.Header.Get("Origin") != "http://localhost:5173" {
			t.Fatal("headers or IP lost")
		}
		http.SetCookie(w, &http.Cookie{Name: "kitchen_session", Value: "token", HttpOnly: true})
		w.WriteHeader(201)
		_, _ = w.Write([]byte("ok"))
	})
	rr, e := proxy(context.Background(), event, h)
	if e != nil || rr.StatusCode != 201 || rr.Body != "ok" || len(rr.MultiValueHeaders["Set-Cookie"]) != 1 {
		t.Fatalf("%+v %v", rr, e)
	}
}
