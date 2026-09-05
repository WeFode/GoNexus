# 从仓库根目录构建（依赖 ../pkg/etcdcfg）：
#   docker build -t shop-server:latest -f shop-server/Dockerfile .

FROM golang:1.25-alpine AS builder
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY pkg/etcdcfg ./pkg/etcdcfg
COPY shop-server ./shop-server
WORKDIR /src/shop-server
RUN go mod download
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /out/main .

FROM alpine:3.18
RUN apk add --no-cache tzdata ca-certificates wget && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone
WORKDIR /app
COPY --from=builder /out/main /app/main
COPY shop-server/manifest/config/config.example.yaml /app/manifest/config/config.yaml
RUN mkdir -p /app/logs /app/data/files /app/data/config-cache && chmod +x /app/main
EXPOSE 8000
CMD ["/app/main"]
