package cmd

import (
	"context"
	"os"
	"path/filepath"

	"configure-center/pkg/etcdcfg"
	"configure-center/pkg/obslog"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gcmd"

	"shop-server/internal/controller/config"
	"shop-server/internal/controller/product"
)

var (
	Main = gcmd.Command{
		Name:  "main",
		Usage: "main",
		Brief: "shop-server HTTP API",
		Func: func(ctx context.Context, parser *gcmd.Parser) (err error) {
			// 先接入日志上报，确保启动期的配置加载日志也能被中台看到。
			obs := obslog.Setup("shop-server")
			if obs.Enabled() {
				defer obs.Close()
				g.Log().Info(ctx, "可观测日志上报已启用")
			}

			if err = etcdcfg.Boot(ctx); err != nil {
				return err
			}

			s := g.Server()
			obs.AttachLogger(s.Logger())
			setupSwaggerUI(s)
			s.Use(obs.Middleware)
			s.Use(func(r *ghttp.Request) {
				r.Response.CORSDefault()
				r.Middleware.Next()
			})

			s.Group("/api/v1", func(group *ghttp.RouterGroup) {
				group.Middleware(ghttp.MiddlewareHandlerResponse)
				etcdcfg.BindHealth(group)
				group.Bind(
					config.NewV1(),
					product.NewV1(),
				)
			})

			filesDir := filepath.Join("data", "files")
			_ = os.MkdirAll(filesDir, 0o755)
			s.AddStaticPath("/files", filesDir)

			s.Run()
			return nil
		},
	}
)
