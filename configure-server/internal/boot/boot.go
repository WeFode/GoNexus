package boot

import (
	"context"

	"configure-center/pkg/etcdcfg"
	"github.com/gogf/gf/v2/frame/g"

	"configure-server/internal/service"
	"configure-server/utility/authx"
	"configure-server/utility/etcdx"
)

const historyDDL = `
CREATE TABLE IF NOT EXISTS config_history (
    id          BIGSERIAL PRIMARY KEY,
    config_key  VARCHAR(255) NOT NULL,
    version     INT          NOT NULL,
    content     TEXT         NOT NULL DEFAULT '',
    action_type VARCHAR(16)  NOT NULL,
    operator    VARCHAR(64)  NOT NULL DEFAULT '',
    remark      VARCHAR(255) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_config_history_key_ver ON config_history (config_key, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uk_config_history_key_ver ON config_history (config_key, version);

CREATE TABLE IF NOT EXISTS deploy_nodes (
    node_id          VARCHAR(64) PRIMARY KEY,
    hostname         VARCHAR(255) NOT NULL DEFAULT '',
    os               VARCHAR(32)  NOT NULL DEFAULT '',
    arch             VARCHAR(32)  NOT NULL DEFAULT '',
    docker_platform  VARCHAR(64)  NOT NULL DEFAULT '',
    docker_network   VARCHAR(128) NOT NULL DEFAULT '',
    loopback_as      VARCHAR(128) NOT NULL DEFAULT '',
    ncpu             INT          NOT NULL DEFAULT 0,
    memory_bytes     BIGINT       NOT NULL DEFAULT 0,
    agent_version    VARCHAR(32)  NOT NULL DEFAULT '',
    containers       TEXT         NOT NULL DEFAULT '[]',
    last_seen        TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS deploy_artifacts (
    id              BIGSERIAL PRIMARY KEY,
    service_name    VARCHAR(128) NOT NULL,
    image_name      VARCHAR(255) NOT NULL,
    platform        VARCHAR(64)  NOT NULL,
    container_port  INT          NOT NULL DEFAULT 0,
    file_path       VARCHAR(512) NOT NULL,
    file_size       BIGINT       NOT NULL DEFAULT 0,
    sha256          VARCHAR(64)  NOT NULL DEFAULT '',
    operator        VARCHAR(64)  NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS deploy_jobs (
    id              BIGSERIAL PRIMARY KEY,
    node_id         VARCHAR(64)  NOT NULL,
    artifact_id     BIGINT       NOT NULL DEFAULT 0,
    service_name    VARCHAR(128) NOT NULL,
    action          VARCHAR(16)  NOT NULL,
    status          VARCHAR(16)  NOT NULL,
    image_name      VARCHAR(255) NOT NULL DEFAULT '',
    host_port       INT          NOT NULL DEFAULT 0,
    docker_network  VARCHAR(128) NOT NULL DEFAULT '',
    loopback_as     VARCHAR(128) NOT NULL DEFAULT '',
    message         TEXT         NOT NULL DEFAULT '',
    operator        VARCHAR(64)  NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deploy_jobs_node ON deploy_jobs (node_id, status, id);
`

func Init(ctx context.Context) error {
	if err := authx.Init(ctx); err != nil {
		return err
	}

	if err := ensureHistoryDB(ctx); err != nil {
		g.Log().Warningf(ctx, "审计库不可用，历史/回滚接口将失败: %v", err)
	}

	host := g.Cfg().MustGet(ctx, "svc.etcd.host").String()
	client, err := etcdcfg.NewClient(ctx, etcdcfg.Options{
		Host:     host,
		Username: g.Cfg().MustGet(ctx, "svc.etcd.username").String(),
		Password: g.Cfg().MustGet(ctx, "svc.etcd.password").String(),
		Prefix:   g.Cfg().MustGet(ctx, "svc.etcd.prefix").String(),
	})
	if err != nil {
		return err
	}
	etcdx.Set(client)

	seedDir := g.Cfg().MustGet(ctx, "svc.etcd.seedDir").String()
	if seedDir == "" {
		seedDir = "manifest/etcd-seed"
	}
	n, err := service.Config().Seed(ctx, seedDir, false, service.Audit{Operator: "seed", Remark: "startup seed"})
	if err != nil {
		g.Log().Warningf(ctx, "etcd seed 跳过: %v", err)
	} else {
		g.Log().Infof(ctx, "etcd seed 完成: 写入 %d 个缺失配置, dir=%s prefix=%s", n, seedDir, client.Prefix())
	}
	g.Log().Infof(ctx, "配置中心已连接 etcd: %v", client.Endpoints())
	return nil
}

func ensureHistoryDB(ctx context.Context) error {
	val, err := g.DB("postgres").GetValue(ctx, `SELECT 1 FROM pg_database WHERE datname = 'config_center'`)
	if err != nil {
		return err
	}
	if val.IsEmpty() {
		if _, err = g.DB("postgres").Exec(ctx, `CREATE DATABASE config_center`); err != nil {
			return err
		}
		g.Log().Infof(ctx, "已创建数据库 config_center")
	}
	_, err = g.DB().Exec(ctx, historyDDL)
	return err
}
