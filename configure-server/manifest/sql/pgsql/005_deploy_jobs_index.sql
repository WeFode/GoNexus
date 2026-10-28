-- 已有 config_center 库补发布任务的超时回收索引（新库由 001_schema.sql 创建）。
-- 没有它时 reclaimStaleJobs 的 status='running' AND updated_at < ? 会随任务表增长退化为全表扫描。
--   psql -U postgres -h 127.0.0.1 -p 5433 -d config_center -f 005_deploy_jobs_index.sql

CREATE INDEX IF NOT EXISTS idx_deploy_jobs_status_updated ON deploy_jobs (status, updated_at);
