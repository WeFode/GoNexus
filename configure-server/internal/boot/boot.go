package boot

import (
	"context"

	"configure-center/pkg/etcdcfg"
	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"

	"configure-server/internal/service"
	"configure-server/utility/authx"
	"configure-server/utility/etcdx"
)

func Init(ctx context.Context) error {
	if err := authx.Init(ctx); err != nil {
		return err
	}

	if err := pingAuditDB(ctx); err != nil {
		g.Log().Warningf(ctx, "%v", err)
	}

	host := g.Cfg().MustGet(ctx, "svc.etcd.host").String()
	client, err := etcdcfg.NewClient(ctx, etcdcfg.Options{
		Host:     host,
		Username: g.Cfg().MustGet(ctx, "svc.etcd.username").String(),
		Password: g.Cfg().MustGet(ctx, "svc.etcd.password").String(),
		Prefix:   g.Cfg().MustGet(ctx, "svc.etcd.prefix").String(),
	})
	if err != nil {
		return err
	}
	etcdx.Set(client)

	seedDir := g.Cfg().MustGet(ctx, "svc.etcd.seedDir").String()
	if seedDir == "" {
		seedDir = "manifest/etcd-seed"
	}
	n, err := service.Config().Seed(ctx, seedDir, false, service.Audit{Operator: "seed", Remark: "startup seed"})
	if err != nil {
		g.Log().Warningf(ctx, "etcd seed 跳过: %v", err)
	} else {
		g.Log().Infof(ctx, "etcd seed 完成: 写入 %d 个缺失配置, dir=%s prefix=%s", n, seedDir, client.Prefix())
	}
	g.Log().Infof(ctx, "配置中心已连接 etcd: %v", client.Endpoints())
	return nil
}

func pingAuditDB(ctx context.Context) error {
	if _, err := g.DB().Model("config_history").Count(); err != nil {
		return gerror.Wrap(err, "审计库未就绪，请先执行 manifest/sql/pgsql 或 manifest/sql/dm 中的脚本（进程不会自动建表）")
	}
	return nil
}
