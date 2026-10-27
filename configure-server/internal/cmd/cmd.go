package cmd

import (
	"context"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gcmd"

	"configure-server/internal/boot"
	"configure-server/internal/controller/auth"
	"configure-server/internal/controller/config"
	"configure-server/internal/controller/deploy"
	"configure-server/internal/controller/health"
	"configure-server/internal/middleware"
)

var (
	Main = gcmd.Command{
		Name:  "main",
		Usage: "main",
		Brief: "etcd 配置中心",
		Func: func(ctx context.Context, parser *gcmd.Parser) (err error) {
			if err = boot.Init(ctx); err != nil {
				return err
			}

			s := g.Server()
			s.Use(middleware.CORS)

			s.Group("/api/v1", func(group *ghttp.RouterGroup) {
				group.Middleware(middleware.JWT)
				group.GET("/agent/artifacts/{id}/file", deploy.DownloadArtifact)
			})

			s.Group("/api/v1", func(group *ghttp.RouterGroup) {
				group.Middleware(middleware.JWT, ghttp.MiddlewareHandlerResponse)
				group.Bind(
					health.NewV1(),
					auth.NewV1(),
					config.NewV1(),
					deploy.NewV1(),
				)
			})

			s.Run()
			return nil
		},
	}
)
