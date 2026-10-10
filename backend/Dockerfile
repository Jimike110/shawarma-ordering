FROM golang:1.25.5-alpine AS build
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server && CGO_ENABLED=0 go build -trimpath -o /migrate ./cmd/migrate
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
COPY --from=build /server /usr/local/bin/server
COPY --from=build /migrate /usr/local/bin/migrate
USER app
EXPOSE 8080
CMD ["server"]
