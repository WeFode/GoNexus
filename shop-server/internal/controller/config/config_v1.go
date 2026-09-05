package config

import (
	"context"

	"configure-center/pkg/etcdcfg"
	"github.com/gogf/gf/v2/frame/g"

	v1 "shop-server/api/config/v1"
)

type ControllerV1 struct{}

func NewV1() *ControllerV1 {
	return &ControllerV1{}
}

func (c *ControllerV1) Runtime(ctx context.Context, _ *v1.RuntimeReq) (*v1.RuntimeRes, error) {
	res := &v1.RuntimeRes{
		ShopName: g.Cfg().MustGet(ctx, "test.shopName").String(),
		Test:     g.Cfg().MustGet(ctx, "test").Val(),
	}
	if info, ok := etcdcfg.Runtime(); ok {
		res.Watch = info.Watch
		res.WatchShared = info.WatchShared
		res.StickyKeys = info.StickyKeys
		res.ConfigFrom = info.Source
		res.Changed = info.Changed
		res.EventKeys = info.EventKeys
		if !info.ReloadedAt.IsZero() {
			res.ReloadedAt = info.ReloadedAt.Format("2006-01-02 15:04:05")
		}
	}
	return res, nil
}
