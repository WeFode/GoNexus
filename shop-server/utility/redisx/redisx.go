package redisx

import (
	"context"

	"github.com/gogf/gf/v2/database/gredis"
	"github.com/gogf/gf/v2/frame/g"
)

// Client 返回默认 Redis 客户端。项目启用缓存时直接用：
//
//	ok, err := redisx.Available(ctx)
//	if ok { _ = redisx.Client().Set(ctx, key, val, ttl) }
func Client() *gredis.Redis {
	return g.Redis()
}

// Available 探测 Redis 是否可用。连不上返回 false，不 panic。
func Available(ctx context.Context) bool {
	_, err := g.Redis().Do(ctx, "PING")
	return err == nil
}
