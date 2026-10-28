-- 已有 DEPLOY_JOBS 补发布任务的超时回收索引（新库由 001_schema.sql 创建）。
-- 索引已存在时本条会失败，可忽略后继续。
CREATE INDEX "IDX_DEPLOY_JOBS_STATUS_UPDATED" ON "DEPLOY_JOBS" ("STATUS", "UPDATED_AT");
