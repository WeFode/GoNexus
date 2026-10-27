-- 已有 config_center 库补节点指标列（新库若已执行带这些列的 001，本文件可重复执行）。
--   psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f 003_node_metrics.sql

ALTER TABLE deploy_nodes ADD COLUMN IF NOT EXISTS cpu_used_percent DOUBLE PRECISION NOT NULL DEFAULT -1;
ALTER TABLE deploy_nodes ADD COLUMN IF NOT EXISTS memory_used_bytes BIGINT NOT NULL DEFAULT -1;
ALTER TABLE deploy_nodes ADD COLUMN IF NOT EXISTS memory_source VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE deploy_nodes ADD COLUMN IF NOT EXISTS host_ports TEXT NOT NULL DEFAULT '[]';

COMMENT ON COLUMN deploy_nodes.cpu_used_percent IS '整机 CPU 占用百分比；-1 表示未上报';
COMMENT ON COLUMN deploy_nodes.memory_used_bytes IS '已用内存字节；-1 表示未上报';
COMMENT ON COLUMN deploy_nodes.memory_source IS 'host=整机内存，containers=仅容器内存合计';
COMMENT ON COLUMN deploy_nodes.host_ports IS '运行中容器已发布的宿主机端口，JSON 数组';
