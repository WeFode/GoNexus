-- 配置中心审计库 + 发布编排表（PostgreSQL）。
-- 连接目标：config_center
--   psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f 001_schema.sql
-- 表名/列名小写，与 GoFrame ORM、达梦脚本保持一致。

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

COMMENT ON TABLE config_history IS '配置发布审计（etcd 写入成功后追加；回滚读此表）';
COMMENT ON COLUMN config_history.config_key IS 'etcd 全路径，如 /config-center/services/shop-server';
COMMENT ON COLUMN config_history.action_type IS 'CREATE / UPDATE / BASELINE（变更前快照） / DELETE / ROLLBACK';

CREATE TABLE IF NOT EXISTS deploy_nodes (
    node_id          VARCHAR(64) PRIMARY KEY,
    hostname         VARCHAR(255) NOT NULL DEFAULT '',
    os               VARCHAR(32)  NOT NULL DEFAULT '',
    arch             VARCHAR(32)  NOT NULL DEFAULT '',
    docker_platform  VARCHAR(64)  NOT NULL DEFAULT '',
    docker_network   VARCHAR(128) NOT NULL DEFAULT '',
    loopback_as      VARCHAR(128) NOT NULL DEFAULT '',
    ncpu              INT              NOT NULL DEFAULT 0,
    memory_bytes      BIGINT           NOT NULL DEFAULT 0,
    cpu_used_percent  DOUBLE PRECISION NOT NULL DEFAULT -1,
    memory_used_bytes BIGINT           NOT NULL DEFAULT -1,
    memory_source     VARCHAR(16)      NOT NULL DEFAULT '',
    host_ports        TEXT             NOT NULL DEFAULT '[]',
    agent_version     VARCHAR(32)      NOT NULL DEFAULT '',
    containers        TEXT             NOT NULL DEFAULT '[]',
    last_seen         TIMESTAMPTZ
);
COMMENT ON TABLE deploy_nodes IS 'deploy-agent 心跳；last_seen 用于在线判定';
COMMENT ON COLUMN deploy_nodes.cpu_used_percent IS '整机 CPU 占用百分比；-1 表示未上报';
COMMENT ON COLUMN deploy_nodes.memory_used_bytes IS '已用内存字节；-1 表示未上报';
COMMENT ON COLUMN deploy_nodes.memory_source IS 'host=整机内存，containers=仅容器内存合计';
COMMENT ON COLUMN deploy_nodes.host_ports IS '运行中容器已发布的宿主机端口，JSON 数组';

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
COMMENT ON TABLE deploy_artifacts IS '上传的 docker save tar 元数据';

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
COMMENT ON TABLE deploy_jobs IS '发布任务：waiting（灰度等待）/ pending → running → success/failed；action=deploy|rollback|canary|start|stop|restart|stop-canary';
