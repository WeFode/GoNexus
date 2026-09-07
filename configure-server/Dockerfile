# 从仓库根目录构建（依赖 ../pkg/etcdcfg）：
#   docker build -t configure-server:latest -f configure-server/Dockerfile .

FROM golang:1.25-alpine AS builder
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY pkg/etcdcfg ./pkg/etcdcfg
COPY configure-server ./configure-server
WORKDIR /src/configure-server
RUN go mod download
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -buildvcs=false -ldflags="-s -w" -o /out/main .

FROM alpine:3.18
RUN apk add --no-cache tzdata ca-certificates wget && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone
WORKDIR /app
COPY --from=builder /out/main /app/main
COPY configure-server/manifest/config/config.example.yaml /app/manifest/config/config.yaml
COPY configure-server/manifest/etcd-seed /app/manifest/etcd-seed
COPY configure-server/manifest/sql /app/manifest/sql
RUN chmod +x /app/main
EXPOSE 9000
CMD ["/app/main"]
