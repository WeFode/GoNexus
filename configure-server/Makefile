ROOT_DIR    = $(shell pwd)
NAMESPACE   = "default"
DEPLOY_NAME = "configure-server"
DOCKER_NAME = "configure-server"
IMAGE       ?= configure-server:latest
DIST_TAR    ?= ../deploy/dist/configure-server-image.tar

include ./hack/hack-cli.mk
include ./hack/hack.mk

.PHONY: docker-up
docker-up:
	@docker compose up -d

.PHONY: docker-down
docker-down:
	@docker compose down

.PHONY: docker-logs
docker-logs:
	@docker compose logs -f

.PHONY: gen
gen: ctrl service

.PHONY: run
run:
	@go run .

.PHONY: tidy
tidy:
	@go mod tidy

.PHONY: image
image:
	@docker build -t $(IMAGE) -f Dockerfile ..

.PHONY: package
package: image
	@mkdir -p $(dir $(DIST_TAR))
	@docker save $(IMAGE) -o $(DIST_TAR)
	@ls -lh $(DIST_TAR)
	@echo "scp $(DIST_TAR) user@server:/usr/local/docker/work/"
	@echo "ssh: docker load -i /usr/local/docker/work/$$(basename $(DIST_TAR))"

.PHONY: help
help:
	@echo "可用命令:"
	@echo "  make docker-up     - 启动 etcd / Postgres / Redis"
	@echo "  make docker-down   - 停止本地依赖容器"
	@echo "  make ctrl/service/gen"
	@echo "  make run           - 本地 go run（:9000）"
	@echo "  make build         - gf build 编译"
	@echo "  make image         - docker build 应用镜像"
	@echo "  make package       - build + docker save 导出 tar"
	@echo "  make tidy          - go mod tidy"
