FROM scratch
WORKDIR /app
COPY main /app/main
COPY config.yaml /app/manifest/config/config.yaml
COPY seed /app/manifest/etcd-seed
# 不写 EXPOSE：容器端口由 catalog.json / 发布时的 containerPort 决定。
ENTRYPOINT ["/app/main"]
