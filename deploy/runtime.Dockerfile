FROM scratch
WORKDIR /app
COPY main /app/main
COPY config.yaml /app/manifest/config/config.yaml
COPY seed /app/manifest/etcd-seed
EXPOSE 8000
ENTRYPOINT ["/app/main"]
