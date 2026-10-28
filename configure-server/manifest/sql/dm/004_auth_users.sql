-- 配置中心登录账户表（达梦 DM8）
-- 由 CONFIG_CENTER 用户执行一次。执行后 Web 登录改从本表校验（bcrypt 哈希），
-- 并带登录失败锁定；进程不会自动建表。
-- 首次启动时若表为空，会用 configure-server config.yaml 的 auth.users 自动写入初始账户。

CREATE TABLE IF NOT EXISTS "AUTH_USERS" (
    "ID"            BIGINT IDENTITY(1,1) NOT NULL,
    "USERNAME"      VARCHAR(64) NOT NULL,
    "PASSWORD_HASH" VARCHAR(128) NOT NULL,
    "ROLE"          VARCHAR(16) DEFAULT 'operator' NOT NULL,
    "ENABLED"       SMALLINT DEFAULT 1 NOT NULL,
    "CREATED_AT"    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "LAST_LOGIN"    TIMESTAMP,
    CONSTRAINT "PK_AUTH_USERS" PRIMARY KEY ("ID")
);

CREATE UNIQUE INDEX "UK_AUTH_USERS_USERNAME" ON "AUTH_USERS" ("USERNAME");

COMMENT ON TABLE "AUTH_USERS" IS '配置中心 Web 登录账户（bcrypt 哈希；登录失败 5 次锁定 10 分钟）';
COMMENT ON COLUMN "AUTH_USERS"."ROLE" IS 'admin / operator';
COMMENT ON COLUMN "AUTH_USERS"."ENABLED" IS '1 启用 0 禁用';
