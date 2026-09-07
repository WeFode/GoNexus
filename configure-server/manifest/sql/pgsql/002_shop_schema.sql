-- GoFrame scaffold · products demo
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS products (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(128)  NOT NULL,
    description TEXT          NOT NULL DEFAULT '',
    price       NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock       INT           NOT NULL DEFAULT 0,
    status      SMALLINT      NOT NULL DEFAULT 1, -- 1=上架 0=下架
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);

COMMENT ON TABLE products IS '商品表（脚手架示例）';
COMMENT ON COLUMN products.name IS '商品名称';
COMMENT ON COLUMN products.description IS '商品描述';
COMMENT ON COLUMN products.price IS '价格';
COMMENT ON COLUMN products.stock IS '库存';
COMMENT ON COLUMN products.status IS '状态：1上架 0下架';


        -- 示例商品数据（可按需删除）
INSERT INTO products (name, description, price, stock, status)
VALUES
    ('示例商品 A', '脚手架演示商品', 99.00, 100, 1),
    ('示例商品 B', '脚手架演示商品', 199.50, 50, 1);
