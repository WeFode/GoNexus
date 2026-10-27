package cmd

import (
	"context"
	"os"
	"path/filepath"

	"configure-center/pkg/etcdcfg"
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
			if err = etcdcfg.Boot(ctx); err != nil {
				return err
			}

			s := g.Server()
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
