package etcdcfg

import (
	"context"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
)

// Boot 读取本地 svc.etcd.* 并切换 g.Cfg()。新服务在 cmd 里调用这一行即可。
func Boot(ctx context.Context) error {
	_, err := BootFromLocal(ctx)
	return err
}

// BootFromLocal 同 Boot，额外返回 Adapter，便于自定义探活。
// 必须在 g.Server() / g.DB() / g.Redis() 首次使用之前调用。
func BootFromLocal(ctx context.Context) (*Adapter, error) {
	host := g.Cfg().MustGet(ctx, "svc.etcd.host").String()
	if host == "" {
		return nil, gerror.New("本地配置缺少 svc.etcd.host，格式：ip:port@服务名")
	}
	adapter, err := NewAdapter(ctx, Options{
		Host:            host,
		Username:        g.Cfg().MustGet(ctx, "svc.etcd.username").String(),
		Password:        g.Cfg().MustGet(ctx, "svc.etcd.password").String(),
		Prefix:          g.Cfg().MustGet(ctx, "svc.etcd.prefix").String(),
		Watch:           g.Cfg().MustGet(ctx, "svc.etcd.watch", true).Bool(),
		SkipSharedWatch: g.Cfg().MustGet(ctx, "svc.etcd.skipSharedWatch").Bool(),
		StickyKeys:      g.Cfg().MustGet(ctx, "svc.etcd.stickyKeys").Strings(),
		SnapshotDir:     g.Cfg().MustGet(ctx, "svc.etcd.snapshotDir").String(),
		LoopbackAs:      g.Cfg().MustGet(ctx, "svc.etcd.loopbackAs").String(),
	})
	if err != nil {
		return nil, err
	}
	g.Cfg().SetAdapter(adapter)
	info := adapter.RuntimeInfo()
	g.Log().Infof(ctx, "已加载配置: source=%s endpoints=%v service=%s prefix=%s watch=%v snapshot=%s stickyKeys=%v",
		info.Source, adapterEndpoints(adapter), adapter.ServiceName(), prefixOf(adapter),
		info.Watch, info.SnapshotPath, info.StickyKeys)
	return adapter, nil
}

func adapterEndpoints(a *Adapter) []string {
	if c := a.Client(); c != nil {
		return c.Endpoints()
	}
	return nil
}

func prefixOf(a *Adapter) string {
	if c := a.Client(); c != nil {
		return c.Prefix()
	}
	return DefaultPrefix
}
