package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"shawarma/internal/app"
	"strings"
	"sync"
	"time"
)

var mu sync.Mutex
var api *app.API

func load(ctx context.Context) (*app.API, error) {
	mu.Lock()
	defer mu.Unlock()
	if api != nil {
		return api, nil
	}
	c, e := app.LoadConfig()
	if e != nil {
		return nil, e
	}
	s, e := app.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return nil, e
	}
	api = app.New(s, c)
	return api, nil
}
func proxy(ctx context.Context, event events.APIGatewayProxyRequest, h http.Handler) (events.APIGatewayProxyResponse, error) {
	body := event.Body
	if event.IsBase64Encoded {
		decoded, e := base64.StdEncoding.DecodeString(body)
		if e != nil {
			return events.APIGatewayProxyResponse{StatusCode: 400, Body: "Invalid body"}, nil
		}
		body = string(decoded)
	}
	route := event.Path
	// The redirect passes the original /api suffix explicitly; direct invocation works too.
	suffix, ok := event.QueryStringParameters["route"]
	if ok {
		route = "/api/" + strings.TrimPrefix(suffix, "/")
	}
	query := url.Values{}
	for k, v := range event.QueryStringParameters {
		if k != "route" {
			query.Set(k, v)
		}
	}
	req, e := http.NewRequestWithContext(ctx, event.HTTPMethod, "https://function.invalid"+route+"?"+query.Encode(), strings.NewReader(body))
	if e != nil {
		return events.APIGatewayProxyResponse{}, e
	}
	for k, v := range event.Headers {
		req.Header.Set(k, v)
	}
	for k, v := range event.MultiValueHeaders {
		req.Header.Del(k)
		for _, x := range v {
			req.Header.Add(k, x)
		}
	}
	req.RemoteAddr = event.RequestContext.Identity.SourceIP
	if req.RemoteAddr == "" {
		req.RemoteAddr = req.Header.Get("X-Nf-Client-Connection-Ip")
	}
	if req.RemoteAddr == "" {
		req.RemoteAddr = "netlify"
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return events.APIGatewayProxyResponse{StatusCode: rr.Code, Body: rr.Body.String(), MultiValueHeaders: rr.Header()}, nil
}
func handler(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	h, e := load(ctx)
	if e != nil {
		log.Printf("Function init: %v", e)
		return events.APIGatewayProxyResponse{StatusCode: 503, Headers: map[string]string{"Content-Type": "application/json", "Cache-Control": "no-store"}, Body: fmt.Sprintf("{\"error\":%q}", "Сервис временно недоступен.")}, nil
	}
	return proxy(ctx, event, h)
}
func main() { lambda.Start(handler) }
