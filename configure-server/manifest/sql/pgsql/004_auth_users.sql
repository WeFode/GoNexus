-- 配置中心登录账户表（PostgreSQL）
-- 执行后 Web 登录改从本表校验（bcrypt 哈希），并带登录失败锁定。
-- 首次启动时若表为空，会用 configure-server config.yaml 的 auth.users 自动写入初始账户。

CREATE TABLE IF NOT EXISTS auth_users (
    id            BIGSERIAL PRIMARY KEY,
    username      VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    role          VARCHAR(16) NOT NULL DEFAULT 'operator',
    enabled       SMALLINT NOT NULL DEFAULT 1,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login    TIMESTAMP
);

COMMENT ON TABLE auth_users IS '配置中心 Web 登录账户（bcrypt 哈希；登录失败 5 次锁定 10 分钟）';
